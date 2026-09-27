-- ==============================================================================
-- МИГРАЦИЯ 018: Единый регистр «Операции по ЗП», правила продавцов и FSM статусов
-- ==============================================================================

-- 1. Рефакторинг таблицы employee_payouts в полноценный зарплатный регистр
ALTER TABLE public.employee_payouts
  ADD COLUMN IF NOT EXISTS operation_sign VARCHAR(1) DEFAULT '-' CHECK (operation_sign IN ('+', '-')),
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.connections(connection_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_phone VARCHAR(20) REFERENCES public.sellers(seller_phone) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actual_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Снятие старого ограничения CHECK на operation_type и расширение до новых видов операций
DO $$
BEGIN
    ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS employee_payouts_operation_type_check;
    ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS chk_operation_type;
    ALTER TABLE public.employee_payouts ADD CONSTRAINT employee_payouts_operation_type_check
      CHECK (operation_type IN (
        'accrual_connection',
        'accrual_maintenance',
        'salary_base',
        'bonus_other',
        'deduction',
        'fine',
        'payout'
      ));
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Адаптация payment_method (разрешаем NULL для начислений, проверяем список для выплат)
DO $$
BEGIN
    ALTER TABLE public.employee_payouts ALTER COLUMN payment_method DROP NOT NULL;
    ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS chk_payment_method_payout;
    ALTER TABLE public.employee_payouts ADD CONSTRAINT chk_payment_method_payout
      CHECK (payment_method IS NULL OR payment_method IN ('mbank', 'odengi', 'bakai', 'abank', 'cash'));
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Заполнение значений по умолчанию и backfill
UPDATE public.employee_payouts
SET operation_sign = '-'
WHERE operation_sign IS NULL;

UPDATE public.employee_payouts
SET settlement_month = COALESCE(settlement_month, accrual_month, to_char(COALESCE(payout_date, created_at::date, CURRENT_DATE), 'YYYY-MM'))
WHERE settlement_month IS NULL;

UPDATE public.employee_payouts
SET actual_date = COALESCE(payout_date, created_at::date, CURRENT_DATE)
WHERE actual_date IS NULL;

UPDATE public.employee_payouts
SET note = COALESCE(note, comment, description)
WHERE note IS NULL;

UPDATE public.employee_payouts
SET employee_id = COALESCE(employee_id, user_id)
WHERE employee_id IS NULL;

ALTER TABLE public.employee_payouts ALTER COLUMN operation_sign SET NOT NULL;
ALTER TABLE public.employee_payouts ALTER COLUMN actual_date SET NOT NULL;
ALTER TABLE public.employee_payouts ALTER COLUMN settlement_month SET NOT NULL;

-- Индексы для быстрого поиска операций
CREATE INDEX IF NOT EXISTS idx_payouts_emp_month ON public.employee_payouts(employee_id, settlement_month);
CREATE INDEX IF NOT EXISTS idx_payouts_conn ON public.employee_payouts(connection_id);
CREATE INDEX IF NOT EXISTS idx_payouts_sign ON public.employee_payouts(operation_sign);
CREATE INDEX IF NOT EXISTS idx_payouts_type ON public.employee_payouts(operation_type);

-- 2. Обновление процедуры link_lead_to_seller
-- Блокировка привязки если у продавца уже есть куратор + запись в регистр ЗП
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

    -- 2. Блокируем и проверяем продавца на коллизию и наличие куратора
    SELECT * INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
    END IF;

    -- Строгое бизнес-правило: нельзя привязать лид к продавцу с назначенным куратором
    IF v_seller.manager_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'У продавца уже назначен куратор. Чтобы привязать лид, сначала снимите куратора');
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

    -- 9. Первичное начисление в connection_accruals
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

    -- 10. Запись в единый зарплатный регистр employee_payouts (+)
    INSERT INTO public.employee_payouts (
        user_id,
        employee_id,
        accrual_month,
        settlement_month,
        actual_date,
        payout_date,
        amount,
        operation_sign,
        operation_type,
        payout_category,
        connection_id,
        seller_phone,
        note,
        comment,
        status,
        created_by
    ) VALUES (
        v_effective_manager_id,
        v_effective_manager_id,
        v_current_month,
        v_current_month,
        v_now::date,
        v_now::date,
        v_connection_fee_amount,
        '+',
        'accrual_connection',
        'бонус',
        v_connection_id,
        p_seller_phone,
        'Бонус за подключение продавца +' || p_seller_phone,
        'Начислено автоматически при связывании с лидом',
        'paid',
        COALESCE(v_assigned_by, v_effective_manager_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id,
        'seller_phone', p_seller_phone,
        'lead_id', p_lead_id,
        'connection_fee_amount', v_connection_fee_amount
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID) TO authenticated;

-- 3. Обновление процедуры run_maintenance_billing
-- Начисление сопровождения + перевод статуса в 'сопровождение' / 'готов' + запись в регистр ЗП
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
    v_new_status VARCHAR(50);
    v_admin_id UUID;
BEGIN
    v_target_month := COALESCE(p_billing_month, to_char(now(), 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(now(), 'YYYY-MM');
    END IF;

    v_billing_date := to_date(v_target_month || '-01', 'YYYY-MM-DD');

    SELECT user_id INTO v_admin_id FROM public.users WHERE role = 'admin' LIMIT 1;

    FOR v_conn IN 
        SELECT 
            c.connection_id,
            c.seller_phone,
            c.manager_id,
            c.status,
            s.is_active AS seller_active,
            COALESCE(c.maintenance_month_start, to_char((c.assigned_at + INTERVAL '1 month'), 'YYYY-MM')) AS maintenance_month_start,
            COALESCE(c.maintenance_months_total, 2) AS maintenance_months_total,
            COALESCE(c.maintenance_months_accrued, 0) AS maintenance_months_accrued,
            COALESCE(c.maintenance_fee_monthly, round((c.plan_price * 10.0 / 100.0), 2)) AS maintenance_fee_monthly
        FROM public.connections c
        JOIN public.sellers s ON s.seller_phone = c.seller_phone
        WHERE c.status IN ('подключен', 'сопровождение')
          AND c.manager_id IS NOT NULL
          AND s.is_active = true
    LOOP
        IF v_conn.maintenance_month_start IS NOT NULL THEN
            v_start_date := to_date(v_conn.maintenance_month_start || '-01', 'YYYY-MM-DD');
            v_month_diff := (EXTRACT(YEAR FROM v_billing_date) - EXTRACT(YEAR FROM v_start_date)) * 12 
                            + (EXTRACT(MONTH FROM v_billing_date) - EXTRACT(MONTH FROM v_start_date));

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

                    -- Добавляем операцию начисления (+) в зарплатный регистр
                    INSERT INTO public.employee_payouts (
                        user_id,
                        employee_id,
                        accrual_month,
                        settlement_month,
                        actual_date,
                        payout_date,
                        amount,
                        operation_sign,
                        operation_type,
                        payout_category,
                        connection_id,
                        seller_phone,
                        note,
                        comment,
                        status,
                        created_by
                    ) VALUES (
                        v_conn.manager_id,
                        v_conn.manager_id,
                        v_target_month,
                        v_target_month,
                        v_billing_date,
                        v_billing_date,
                        v_conn.maintenance_fee_monthly,
                        '+',
                        'accrual_maintenance',
                        'прочие начисления',
                        v_conn.connection_id,
                        v_conn.seller_phone,
                        'Сопровождение (' || (v_month_diff + 1) || ' из ' || v_conn.maintenance_months_total || ' мес.) по +' || v_conn.seller_phone,
                        'Автоматический биллинг за ' || v_target_month,
                        'paid',
                        COALESCE(v_admin_id, v_conn.manager_id)
                    );

                    -- FSM переход: если количество начисленных месяцев достигло лимита -> 'готов'
                    IF (v_month_diff + 1) >= v_conn.maintenance_months_total THEN
                        v_new_status := 'готов';
                    ELSE
                        v_new_status := 'сопровождение';
                    END IF;

                    UPDATE public.connections
                    SET status = v_new_status,
                        client_status = v_new_status::client_lifecycle_status,
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

-- 4. FSM триггер активности продавца: seller.is_active -> connections.status
CREATE OR REPLACE FUNCTION public.handle_seller_activity_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.is_active = false AND (OLD.is_active = true OR OLD.is_active IS NULL) THEN
        -- При деактивации продавца переводим подключения в статус 'приостановлен'
        UPDATE public.connections
        SET status = 'приостановлен',
            client_status = 'приостановлен'
        WHERE seller_phone = NEW.seller_phone
          AND status != 'приостановлен';
    ELSIF NEW.is_active = true AND OLD.is_active = false THEN
        -- При возобновлении активности восстанавливаем статус по жизненному циклу
        UPDATE public.connections
        SET status = CASE
                WHEN maintenance_months_accrued >= maintenance_months_total THEN 'готов'
                WHEN maintenance_months_accrued > 0 THEN 'сопровождение'
                ELSE 'подключен'
            END,
            client_status = CASE
                WHEN maintenance_months_accrued >= maintenance_months_total THEN 'готов'::client_lifecycle_status
                WHEN maintenance_months_accrued > 0 THEN 'сопровождение'::client_lifecycle_status
                ELSE 'подключен'::client_lifecycle_status
            END
        WHERE seller_phone = NEW.seller_phone
          AND status = 'приостановлен';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_activity_fsm ON public.sellers;
CREATE TRIGGER trg_seller_activity_fsm
    AFTER UPDATE OF is_active ON public.sellers
    FOR EACH ROW
    WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
    EXECUTE FUNCTION public.handle_seller_activity_fsm();

-- 5. RLS Политики для employee_payouts (Зарплатный регистр)
ALTER TABLE public.employee_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_select_policy" ON public.employee_payouts;
DROP POLICY IF EXISTS "payouts_modify_policy" ON public.employee_payouts;
DROP POLICY IF EXISTS "payouts_admin_modify" ON public.employee_payouts;
DROP POLICY IF EXISTS "payouts_select_role_isolated" ON public.employee_payouts;

-- SELECT: admin и supervisor видят все; consultant и smm видят только свои строки
CREATE POLICY "payouts_select_role_isolated" ON public.employee_payouts
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
    OR user_id = (SELECT auth.uid())
    OR employee_id = (SELECT auth.uid())
);

-- Мутации (INSERT, UPDATE, DELETE): строго только admin
CREATE POLICY "payouts_admin_modify" ON public.employee_payouts
FOR ALL TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
)
WITH CHECK (
    (SELECT public.get_current_user_role()) = 'admin'
);

-- 6. RLS Политики для sellers
-- Консультант видит только одобренных продавцов со своим manager_id или без куратора
DROP POLICY IF EXISTS "sellers_consultant_select" ON public.sellers;
CREATE POLICY "sellers_consultant_select" ON public.sellers
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
    OR (
        (SELECT public.get_current_user_role()) = 'consultant'
        AND moderation = 'approved'
        AND (manager_id = (SELECT auth.uid()) OR manager_id IS NULL)
    )
);

-- 7. Обновление атомарной процедуры создания операций ЗП
CREATE OR REPLACE FUNCTION public.process_employee_payout_atomic(
    p_user_id UUID,
    p_accrual_month VARCHAR(7),
    p_payout_date DATE,
    p_amount NUMERIC(12,2),
    p_payout_category public.payout_category_type DEFAULT 'выплата зп',
    p_payment_method VARCHAR(50) DEFAULT NULL,
    p_comment TEXT DEFAULT NULL,
    p_created_by UUID DEFAULT NULL,
    p_operation_type VARCHAR(40) DEFAULT 'payout',
    p_settlement_month VARCHAR(7) DEFAULT NULL,
    p_accrual_ids UUID[] DEFAULT NULL,
    p_operation_sign VARCHAR(1) DEFAULT NULL,
    p_connection_id UUID DEFAULT NULL,
    p_seller_phone VARCHAR(20) DEFAULT NULL
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
    v_eff_operation_type VARCHAR(40);
    v_eff_sign VARCHAR(1);
    v_eff_date DATE;
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
        RAISE EXCEPTION 'Невозможно провести операцию для заблокированного сотрудника';
    END IF;

    v_eff_settlement_month := COALESCE(p_settlement_month, p_accrual_month, to_char(COALESCE(p_payout_date, CURRENT_DATE), 'YYYY-MM'));
    v_eff_operation_type := COALESCE(p_operation_type, 'payout');
    v_eff_date := COALESCE(p_payout_date, CURRENT_DATE);

    IF p_operation_sign IS NOT NULL THEN
        v_eff_sign := p_operation_sign;
    ELSIF v_eff_operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') THEN
        v_eff_sign := '+';
    ELSE
        v_eff_sign := '-';
    END IF;

    INSERT INTO public.employee_payouts (
        user_id,
        employee_id,
        accrual_month,
        settlement_month,
        actual_date,
        payout_date,
        amount,
        operation_sign,
        operation_type,
        payout_category,
        payment_method,
        connection_id,
        seller_phone,
        note,
        comment,
        description,
        status,
        created_by,
        created_at
    ) VALUES (
        p_user_id,
        p_user_id,
        v_eff_settlement_month,
        v_eff_settlement_month,
        v_eff_date,
        v_eff_date,
        p_amount,
        v_eff_sign,
        v_eff_operation_type,
        COALESCE(p_payout_category, 'выплата зп'),
        p_payment_method,
        p_connection_id,
        p_seller_phone,
        p_comment,
        p_comment,
        p_comment,
        'paid',
        COALESCE(p_created_by, p_user_id),
        now()
    ) RETURNING payout_id INTO v_new_payout_id;

    -- Если выбраны начисления для привязки к выплате, закрываем их
    IF p_accrual_ids IS NOT NULL AND array_length(p_accrual_ids, 1) > 0 THEN
        UPDATE public.connection_accruals
        SET is_paid = true,
            payout_id = v_new_payout_id,
            paid_at = now()
        WHERE id = ANY(p_accrual_ids);
    END IF;

    RETURN json_build_object(
        'success', true,
        'payout_id', v_new_payout_id,
        'operation_sign', v_eff_sign,
        'operation_type', v_eff_operation_type
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_employee_payout_atomic(
    UUID, VARCHAR, DATE, NUMERIC, public.payout_category_type, VARCHAR, TEXT, UUID, VARCHAR, VARCHAR, UUID[], VARCHAR, UUID, VARCHAR
) TO authenticated;

GRANT ALL ON public.employee_payouts TO authenticated;

