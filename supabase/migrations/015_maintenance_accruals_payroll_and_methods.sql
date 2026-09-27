-- ==============================================================================
-- 015_maintenance_accruals_payroll_and_methods.sql
-- Рефакторинг модуля Подключений (Сопровождение 2 мес, Начисления, Биллинг),
-- методы выплат, удержания и расчетный листок (Payslip) сотрудника
-- ==============================================================================

-- 1. Модификация таблицы connections: добавление параметров срока и сумм сопровождения
ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS maintenance_months_total INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS maintenance_month_start VARCHAR(7),
  ADD COLUMN IF NOT EXISTS maintenance_fee_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS connection_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Обновление значений по умолчанию для новых записей
ALTER TABLE public.connections ALTER COLUMN status SET DEFAULT 'подключен';
ALTER TABLE public.connections ALTER COLUMN client_status SET DEFAULT 'подключен';

-- Инициализация исторических данных
UPDATE public.connections
SET connection_fee = COALESCE(connection_fee_amount, 0)
WHERE connection_fee = 0 AND connection_fee_amount > 0;

UPDATE public.connections
SET maintenance_fee_monthly = round((plan_price * 10.0 / 100.0), 2)
WHERE maintenance_fee_monthly = 0 AND plan_price > 0;

UPDATE public.connections
SET maintenance_month_start = to_char((assigned_at + INTERVAL '1 month'), 'YYYY-MM')
WHERE maintenance_month_start IS NULL AND assigned_at IS NOT NULL;

-- 2. Реестр начислений кураторам connection_accruals
CREATE TABLE IF NOT EXISTS public.connection_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  seller_phone VARCHAR(20) NOT NULL REFERENCES public.sellers(seller_phone) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  accrual_type VARCHAR(20) NOT NULL CHECK (accrual_type IN ('connection', 'maintenance')),
  settlement_month VARCHAR(7) NOT NULL, -- Формат 'YYYY-MM'
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  payout_id UUID REFERENCES public.employee_payouts(payout_id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_conn_accrual UNIQUE (connection_id, accrual_type, settlement_month)
);

CREATE INDEX IF NOT EXISTS idx_conn_accruals_emp_month ON public.connection_accruals(employee_id, settlement_month);
CREATE INDEX IF NOT EXISTS idx_conn_accruals_conn ON public.connection_accruals(connection_id);
CREATE INDEX IF NOT EXISTS idx_conn_accruals_payout ON public.connection_accruals(payout_id);

-- RLS для connection_accruals
ALTER TABLE public.connection_accruals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conn_accruals_select_policy" ON public.connection_accruals;
CREATE POLICY "conn_accruals_select_policy" ON public.connection_accruals
FOR SELECT TO authenticated
USING (
  (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
  OR employee_id = (SELECT public.get_current_crm_user_id())
);

DROP POLICY IF EXISTS "conn_accruals_modify_policy" ON public.connection_accruals;
CREATE POLICY "conn_accruals_modify_policy" ON public.connection_accruals
FOR ALL TO authenticated
USING ((SELECT public.get_current_user_role()) IN ('admin', 'supervisor'))
WITH CHECK ((SELECT public.get_current_user_role()) IN ('admin', 'supervisor'));

GRANT ALL ON public.connection_accruals TO authenticated;

-- Миграция первичных начислений из существующих connections
INSERT INTO public.connection_accruals (
  connection_id,
  seller_phone,
  employee_id,
  accrual_type,
  settlement_month,
  amount,
  is_paid,
  notes
)
SELECT 
  connection_id,
  seller_phone,
  manager_id,
  'connection',
  accrual_month,
  COALESCE(connection_fee_amount, 0),
  false,
  'Первичное подключение'
FROM public.connections
WHERE manager_id IS NOT NULL AND accrual_month IS NOT NULL
ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

-- 3. Модификация таблицы employee_payouts для поддержки методов выплат и удержаний
ALTER TABLE public.employee_payouts
  ADD COLUMN IF NOT EXISTS settlement_month VARCHAR(7),
  ADD COLUMN IF NOT EXISTS operation_type VARCHAR(20) DEFAULT 'payout' CHECK (operation_type IN ('payout', 'deduction')),
  ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE public.employee_payouts
SET settlement_month = accrual_month
WHERE settlement_month IS NULL;

UPDATE public.employee_payouts
SET operation_type = CASE WHEN payout_category = 'удержание' THEN 'deduction' ELSE 'payout' END
WHERE operation_type IS NULL OR operation_type = 'payout';

UPDATE public.employee_payouts
SET description = comment
WHERE description IS NULL AND comment IS NOT NULL;

-- 4. Обновление процедуры link_lead_to_seller: создание связи в статусе 'подключен' и фиксация начисления
DROP FUNCTION IF EXISTS public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
    p_lead_id UUID,
    p_seller_phone VARCHAR,
    p_user_id UUID DEFAULT NULL,
    p_manager_id UUID DEFAULT NULL,
    p_assigned_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_lead RECORD;
    v_seller RECORD;
    v_collision_lead RECORD;
    v_plan_price NUMERIC(12,2) := 2500.00;
    v_connection_percent NUMERIC(5,2) := 30.00;
    v_maintenance_percent NUMERIC(5,2) := 10.00;
    v_connection_fee_amount NUMERIC(12,2);
    v_maintenance_fee_monthly NUMERIC(12,2);
    v_connection_id UUID;
    v_current_month VARCHAR(7);
    v_maint_start_month VARCHAR(7);
    v_now TIMESTAMPTZ := now();
    v_assigned_by UUID;
    v_effective_manager_id UUID;
BEGIN
    v_assigned_by := COALESCE(p_assigned_by, p_user_id);

    -- 1. Блокируем и проверяем лид
    SELECT * INTO v_lead FROM public.leads WHERE lead_id = p_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид не найден в системе');
    END IF;

    IF v_lead.seller_phone IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Этот лид уже связан с продавцом +' || v_lead.seller_phone);
    END IF;

    IF v_lead.status = 'Подписан' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид уже имеет статус «Подписан»');
    END IF;

    IF v_lead.status = 'Отмена' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Нельзя привязать отмененный лид');
    END IF;

    -- 2. Блокируем и проверяем продавца на коллизию
    SELECT * INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
    END IF;

    SELECT lead_id, client_name INTO v_collision_lead 
    FROM public.leads 
    WHERE seller_phone = p_seller_phone 
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец +' || p_seller_phone || ' уже привязан к другому лиду («' || v_collision_lead.client_name || '»)');
    END IF;

    -- 3. Определяем эффективного менеджера / консультанта
    v_effective_manager_id := COALESCE(p_manager_id, v_lead.assigned_to, v_assigned_by);

    -- 4. Получаем стоимость тарифа продавца
    IF v_seller.plan_id IS NOT NULL THEN
        SELECT price INTO v_plan_price FROM public.plans WHERE plan_id = v_seller.plan_id;
        IF v_plan_price IS NULL OR v_plan_price <= 0 THEN 
            v_plan_price := 2500.00; 
        END IF;
    END IF;

    -- 5. Получаем персональную ставку комиссии консультанта
    IF v_effective_manager_id IS NOT NULL THEN
        SELECT connection_percent, maintenance_percent 
        INTO v_connection_percent, v_maintenance_percent
        FROM public.employee_rates
        WHERE user_id = v_effective_manager_id
        ORDER BY effective_from DESC
        LIMIT 1;
    END IF;

    IF v_connection_percent IS NULL THEN v_connection_percent := 30.00; END IF;
    IF v_maintenance_percent IS NULL THEN v_maintenance_percent := 10.00; END IF;

    v_connection_fee_amount := round((v_plan_price * v_connection_percent / 100.0), 2);
    v_maintenance_fee_monthly := round((v_plan_price * v_maintenance_percent / 100.0), 2);
    v_current_month := to_char(v_now, 'YYYY-MM');
    v_maint_start_month := to_char((v_now + INTERVAL '1 month'), 'YYYY-MM');

    -- 6. Обновляем лид
    UPDATE public.leads
    SET seller_phone = p_seller_phone,
        status = 'Подписан',
        linked_at = v_now,
        assigned_to = v_effective_manager_id,
        updated_at = v_now
    WHERE lead_id = p_lead_id;

    -- 7. Обновляем продавца: привязываем куратора
    UPDATE public.sellers
    SET manager_id = v_effective_manager_id
    WHERE seller_phone = p_seller_phone;

    -- 8. Создаем запись в connections в статусе 'подключен' со сроком 2 месяца
    INSERT INTO public.connections (
        seller_phone,
        seller_name,
        store,
        manager_id,
        assigned_by,
        assigned_at,
        status,
        plan_id,
        plan_price,
        connection_fee_percent,
        connection_fee_amount,
        connection_fee,
        maintenance_fee_monthly,
        accrual_month,
        maintenance_month_start,
        client_status,
        maintenance_months_total,
        maintenance_months_limit,
        maintenance_months_accrued
    ) VALUES (
        p_seller_phone,
        COALESCE(v_seller.seller_name, v_lead.client_name),
        COALESCE(v_seller.store, 'Без названия'),
        v_effective_manager_id,
        COALESCE(v_assigned_by, v_effective_manager_id),
        v_now,
        'подключен',
        v_seller.plan_id,
        v_plan_price,
        v_connection_percent,
        v_connection_fee_amount,
        v_connection_fee_amount,
        v_maintenance_fee_monthly,
        v_current_month,
        v_maint_start_month,
        'подключен',
        2,
        2,
        0
    ) RETURNING connection_id INTO v_connection_id;

    -- 9. Сразу генерируем первичное начисление в connection_accruals
    INSERT INTO public.connection_accruals (
        connection_id,
        seller_phone,
        employee_id,
        accrual_type,
        settlement_month,
        amount,
        is_paid,
        notes
    ) VALUES (
        v_connection_id,
        p_seller_phone,
        v_effective_manager_id,
        'connection',
        v_current_month,
        v_connection_fee_amount,
        false,
        'Бонус за подключение клиента'
    ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id,
        'connection_fee_amount', v_connection_fee_amount,
        'lead_id', p_lead_id,
        'seller_phone', p_seller_phone
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID) TO authenticated;

-- 5. RPC процедура биллинга сопровождения run_maintenance_billing
CREATE OR REPLACE FUNCTION public.run_maintenance_billing(
    p_billing_month VARCHAR(7) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conn RECORD;
    v_generated_count INT := 0;
    v_month_diff INT;
    v_billing_date DATE;
    v_start_date DATE;
    v_accrual_id UUID;
    v_target_month VARCHAR(7);
BEGIN
    v_target_month := COALESCE(p_billing_month, to_char(now(), 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(now(), 'YYYY-MM');
    END IF;

    v_billing_date := to_date(v_target_month || '-01', 'YYYY-MM-DD');

    FOR v_conn IN 
        SELECT 
            c.connection_id,
            c.seller_phone,
            c.manager_id,
            c.status,
            COALESCE(c.maintenance_month_start, to_char((c.assigned_at + INTERVAL '1 month'), 'YYYY-MM')) AS maintenance_month_start,
            COALESCE(c.maintenance_months_total, 2) AS maintenance_months_total,
            COALESCE(c.maintenance_months_accrued, 0) AS maintenance_months_accrued,
            COALESCE(c.maintenance_fee_monthly, round((c.plan_price * 10.0 / 100.0), 2)) AS maintenance_fee_monthly
        FROM public.connections c
        WHERE c.status IN ('подключен', 'сопровождение')
          AND c.manager_id IS NOT NULL
    LOOP
        IF v_conn.maintenance_month_start IS NOT NULL THEN
            v_start_date := to_date(v_conn.maintenance_month_start || '-01', 'YYYY-MM-DD');
            v_month_diff := (EXTRACT(YEAR FROM v_billing_date) - EXTRACT(YEAR FROM v_start_date)) * 12 
                            + (EXTRACT(MONTH FROM v_billing_date) - EXTRACT(MONTH FROM v_start_date));

            -- Проверяем, попадает ли месяц биллинга в допустимый диапазон срока сопровождения
            IF v_month_diff >= 0 AND v_month_diff < v_conn.maintenance_months_total THEN
                v_accrual_id := NULL;

                INSERT INTO public.connection_accruals (
                    connection_id,
                    seller_phone,
                    employee_id,
                    accrual_type,
                    settlement_month,
                    amount,
                    is_paid,
                    notes
                ) VALUES (
                    v_conn.connection_id,
                    v_conn.seller_phone,
                    v_conn.manager_id,
                    'maintenance',
                    v_target_month,
                    v_conn.maintenance_fee_monthly,
                    false,
                    'Сопровождение (' || (v_month_diff + 1) || ' из ' || v_conn.maintenance_months_total || ' мес.)'
                )
                ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING
                RETURNING id INTO v_accrual_id;

                IF v_accrual_id IS NOT NULL THEN
                    v_generated_count := v_generated_count + 1;

                    -- Обновляем статус и количество начисленных месяцев
                    UPDATE public.connections
                    SET status = 'сопровождение',
                        client_status = 'сопровождение',
                        maintenance_months_accrued = LEAST(v_month_diff + 1, v_conn.maintenance_months_total)
                    WHERE connection_id = v_conn.connection_id;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'billing_month', v_target_month,
        'generated_accruals', v_generated_count,
        'message', 'Сформировано начислений сопровождения: ' || v_generated_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_maintenance_billing(VARCHAR) TO authenticated;

-- 6. RPC процедура расчетного листа get_employee_payroll_sheet
CREATE OR REPLACE FUNCTION public.get_employee_payroll_sheet(
    p_employee_id UUID,
    p_month VARCHAR(7) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_month VARCHAR(7);
    v_opening_accrued NUMERIC(12,2) := 0;
    v_opening_deductions NUMERIC(12,2) := 0;
    v_opening_paid NUMERIC(12,2) := 0;
    v_opening_balance NUMERIC(12,2) := 0;

    v_current_accrued NUMERIC(12,2) := 0;
    v_current_deductions NUMERIC(12,2) := 0;
    v_current_paid NUMERIC(12,2) := 0;
    v_closing_balance NUMERIC(12,2) := 0;

    v_accruals JSONB := '[]'::jsonb;
    v_deductions JSONB := '[]'::jsonb;
    v_payouts JSONB := '[]'::jsonb;
BEGIN
    v_target_month := COALESCE(p_month, to_char(now(), 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(now(), 'YYYY-MM');
    END IF;

    -- 1. Сальдо на начало месяца: сумма всех начислений до v_target_month
    SELECT COALESCE(sum(amount), 0)
    INTO v_opening_accrued
    FROM public.connection_accruals
    WHERE employee_id = p_employee_id
      AND settlement_month < v_target_month;

    -- Все удержания до v_target_month
    SELECT COALESCE(sum(amount), 0)
    INTO v_opening_deductions
    FROM public.employee_payouts
    WHERE user_id = p_employee_id
      AND (settlement_month < v_target_month OR (settlement_month IS NULL AND accrual_month < v_target_month))
      AND (payout_category = 'удержание' OR operation_type = 'deduction');

    -- Все выплаты до v_target_month
    SELECT COALESCE(sum(amount), 0)
    INTO v_opening_paid
    FROM public.employee_payouts
    WHERE user_id = p_employee_id
      AND (settlement_month < v_target_month OR (settlement_month IS NULL AND accrual_month < v_target_month))
      AND (payout_category != 'удержание' AND (operation_type IS NULL OR operation_type != 'deduction'));

    v_opening_balance := v_opening_accrued - v_opening_deductions - v_opening_paid;

    -- 2. Начисления за расчетный месяц v_target_month
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', a.id,
                'connection_id', a.connection_id,
                'seller_phone', a.seller_phone,
                'seller_name', COALESCE(s.seller_name, c.seller_name, 'Клиент'),
                'store', COALESCE(s.store, c.store, 'Без магазина'),
                'accrual_type', a.accrual_type,
                'settlement_month', a.settlement_month,
                'amount', a.amount,
                'is_paid', a.is_paid,
                'payout_id', a.payout_id,
                'paid_at', a.paid_at,
                'notes', a.notes,
                'created_at', a.created_at
            ) ORDER BY a.created_at ASC
        ), '[]'::jsonb),
        COALESCE(sum(a.amount), 0)
    INTO v_accruals, v_current_accrued
    FROM public.connection_accruals a
    LEFT JOIN public.connections c ON c.connection_id = a.connection_id
    LEFT JOIN public.sellers s ON s.seller_phone = a.seller_phone
    WHERE a.employee_id = p_employee_id
      AND a.settlement_month = v_target_month;

    -- 3. Удержания за расчетный месяц v_target_month
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'payout_id', p.payout_id,
                'amount', p.amount,
                'payout_date', p.payout_date,
                'payment_method', p.payment_method,
                'description', COALESCE(p.description, p.comment, 'Удержание'),
                'created_at', p.created_at
            ) ORDER BY p.payout_date ASC
        ), '[]'::jsonb),
        COALESCE(sum(p.amount), 0)
    INTO v_deductions, v_current_deductions
    FROM public.employee_payouts p
    WHERE p.user_id = p_employee_id
      AND (p.settlement_month = v_target_month OR (p.settlement_month IS NULL AND p.accrual_month = v_target_month))
      AND (p.payout_category = 'удержание' OR p.operation_type = 'deduction');

    -- 4. Выплаты за расчетный месяц v_target_month
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'payout_id', p.payout_id,
                'amount', p.amount,
                'payout_date', p.payout_date,
                'payment_method', p.payment_method,
                'description', COALESCE(p.description, p.comment, 'Выплата зарплаты'),
                'created_at', p.created_at
            ) ORDER BY p.payout_date ASC
        ), '[]'::jsonb),
        COALESCE(sum(p.amount), 0)
    INTO v_payouts, v_current_paid
    FROM public.employee_payouts p
    WHERE p.user_id = p_employee_id
      AND (p.settlement_month = v_target_month OR (p.settlement_month IS NULL AND p.accrual_month = v_target_month))
      AND (p.payout_category != 'удержание' AND (p.operation_type IS NULL OR p.operation_type != 'deduction'));

    -- 5. Сальдо на конец месяца
    v_closing_balance := v_opening_balance + v_current_accrued - v_current_deductions - v_current_paid;

    RETURN jsonb_build_object(
        'employee_id', p_employee_id,
        'month', v_target_month,
        'opening_balance', v_opening_balance,
        'total_accrued', v_current_accrued,
        'total_deductions', v_current_deductions,
        'total_paid', v_current_paid,
        'closing_balance', v_closing_balance,
        'accruals', v_accruals,
        'deductions', v_deductions,
        'payouts', v_payouts
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_payroll_sheet(UUID, VARCHAR) TO authenticated;

-- 7. Обновление RPC атомарного проведения выплаты/удержания с привязкой начислений
DROP FUNCTION IF EXISTS public.process_employee_payout_atomic(uuid, character varying, date, numeric, payout_category_type, character varying, text, uuid);

CREATE OR REPLACE FUNCTION public.process_employee_payout_atomic(
    p_user_id UUID,
    p_accrual_month VARCHAR,
    p_payout_date DATE,
    p_amount NUMERIC,
    p_payout_category payout_category_type,
    p_payment_method VARCHAR,
    p_comment TEXT,
    p_created_by UUID,
    p_operation_type VARCHAR DEFAULT 'payout',
    p_settlement_month VARCHAR DEFAULT NULL,
    p_accrual_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_locked_user RECORD;
    v_new_payout_id UUID;
    v_eff_settlement_month VARCHAR(7);
    v_eff_operation_type VARCHAR(20);
BEGIN
    SELECT user_id, full_name, is_active 
    INTO v_locked_user
    FROM public.users
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Сотрудник не найден';
    END IF;

    IF NOT v_locked_user.is_active THEN
        RAISE EXCEPTION 'Невозможно оформить выплату заблокированному сотруднику';
    END IF;

    v_eff_settlement_month := COALESCE(p_settlement_month, p_accrual_month);
    v_eff_operation_type := COALESCE(p_operation_type, CASE WHEN p_payout_category = 'удержание' THEN 'deduction' ELSE 'payout' END);

    INSERT INTO public.employee_payouts (
        user_id,
        accrual_month,
        settlement_month,
        payout_date,
        amount,
        payout_category,
        operation_type,
        payment_method,
        comment,
        description,
        created_by,
        created_at
    ) VALUES (
        p_user_id,
        p_accrual_month,
        v_eff_settlement_month,
        p_payout_date,
        p_amount,
        p_payout_category,
        v_eff_operation_type,
        p_payment_method,
        p_comment,
        p_comment,
        p_created_by,
        now()
    ) RETURNING payout_id INTO v_new_payout_id;

    IF p_accrual_ids IS NOT NULL AND array_length(p_accrual_ids, 1) > 0 THEN
        UPDATE public.connection_accruals
        SET is_paid = true,
            payout_id = v_new_payout_id,
            paid_at = now()
        WHERE id = ANY(p_accrual_ids);
    END IF;

    RETURN json_build_object(
        'success', true,
        'payout_id', v_new_payout_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_employee_payout_atomic(UUID, VARCHAR, DATE, NUMERIC, payout_category_type, VARCHAR, TEXT, UUID, VARCHAR, VARCHAR, UUID[]) TO authenticated;

