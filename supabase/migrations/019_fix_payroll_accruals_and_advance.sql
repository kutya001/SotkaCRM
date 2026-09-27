-- ==============================================================================
-- МИГРАЦИЯ 019: Исправление расчетного листа, операция «Аванс» и начисление бонусов
-- ==============================================================================

-- 1. Гарантируем наличие колонки employee_id в таблице employee_payouts
ALTER TABLE public.employee_payouts
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE;

-- Синхронизация исторических данных между user_id и employee_id
UPDATE public.employee_payouts
SET employee_id = user_id
WHERE employee_id IS NULL AND user_id IS NOT NULL;

UPDATE public.employee_payouts
SET user_id = employee_id
WHERE user_id IS NULL AND employee_id IS NOT NULL;

-- Триггер автоматической синхронизации user_id и employee_id
CREATE OR REPLACE FUNCTION public.sync_employee_payouts_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.employee_id := COALESCE(NEW.employee_id, NEW.user_id);
    NEW.user_id := COALESCE(NEW.user_id, NEW.employee_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_employee_payouts_ids ON public.employee_payouts;
CREATE TRIGGER trg_sync_employee_payouts_ids
    BEFORE INSERT OR UPDATE ON public.employee_payouts
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_employee_payouts_ids();

-- Представление payouts для обратной совместимости старых запросов
CREATE OR REPLACE VIEW public.payouts AS
SELECT * FROM public.employee_payouts;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payouts TO authenticated;

-- 2. Расширение допустимых типов операций: добавление 'advance' (Аванс)
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
        'payout',
        'advance'
      ));
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 3. Обновление атомарной процедуры создания операций ЗП
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
    v_eff_category public.payout_category_type;
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

    -- Автоматическое определение знака операции
    IF p_operation_sign IS NOT NULL THEN
        v_eff_sign := p_operation_sign;
    ELSIF v_eff_operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') THEN
        v_eff_sign := '+';
    ELSE
        v_eff_sign := '-';
    END IF;

    -- Автоматическое определение категории
    IF v_eff_operation_type = 'advance' THEN
        v_eff_category := 'аванс';
    ELSIF v_eff_operation_type = 'deduction' OR v_eff_operation_type = 'fine' THEN
        v_eff_category := 'удержание';
    ELSIF v_eff_operation_type IN ('salary_base', 'accrual_maintenance') THEN
        v_eff_category := 'прочие начисления';
    ELSIF v_eff_operation_type IN ('bonus_other', 'accrual_connection') THEN
        v_eff_category := 'бонус';
    ELSE
        v_eff_category := COALESCE(p_payout_category, 'выплата зп');
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
        v_eff_category,
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

-- 4. Процедура пакетного начисления бонусов по всем подключениям за месяц
CREATE OR REPLACE FUNCTION public.accrue_all_connections_bonuses(
    p_settlement_month VARCHAR(7) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_month VARCHAR(7);
    v_billing_date DATE;
    v_start_date DATE;
    v_month_diff INT;
    v_conn RECORD;
    v_admin_id UUID;
    v_conn_bonus_created INT := 0;
    v_maint_bonus_created INT := 0;
    v_existing_conn_accrual UUID;
    v_existing_conn_payout UUID;
    v_existing_maint_accrual UUID;
    v_existing_maint_payout UUID;
    v_new_status VARCHAR(50);
    v_fee NUMERIC(12,2);
BEGIN
    v_target_month := COALESCE(p_settlement_month, to_char(now(), 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(now(), 'YYYY-MM');
    END IF;

    v_billing_date := to_date(v_target_month || '-01', 'YYYY-MM-DD');

    SELECT user_id INTO v_admin_id FROM public.users WHERE role = 'admin' LIMIT 1;

    -- ШАГ 1: Проверка и начисление бонусов за подключение (accrual_connection)
    FOR v_conn IN
        SELECT 
            c.connection_id,
            c.seller_phone,
            c.manager_id,
            c.status,
            c.assigned_at,
            c.accrual_month,
            COALESCE(c.connection_fee, c.connection_fee_amount, round(c.plan_price * COALESCE(c.connection_fee_percent, 30.0) / 100.0, 2)) AS conn_fee,
            s.is_active AS seller_active
        FROM public.connections c
        JOIN public.sellers s ON s.seller_phone = c.seller_phone
        WHERE c.manager_id IS NOT NULL
          AND s.is_active = true
          AND c.status IN ('подключен', 'сопровождение', 'готов')
          AND (c.accrual_month = v_target_month OR to_char(c.assigned_at, 'YYYY-MM') = v_target_month)
    LOOP
        v_existing_conn_accrual := NULL;
        v_existing_conn_payout := NULL;

        SELECT id INTO v_existing_conn_accrual
        FROM public.connection_accruals
        WHERE connection_id = v_conn.connection_id
          AND accrual_type = 'connection';

        IF v_existing_conn_accrual IS NULL THEN
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
                'connection',
                v_target_month,
                v_conn.conn_fee,
                false,
                'Бонус за подключение клиента'
            ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;
        END IF;

        SELECT payout_id INTO v_existing_conn_payout
        FROM public.employee_payouts
        WHERE connection_id = v_conn.connection_id
          AND operation_type = 'accrual_connection';

        IF v_existing_conn_payout IS NULL THEN
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
                v_conn.conn_fee,
                '+',
                'accrual_connection',
                'бонус',
                v_conn.connection_id,
                v_conn.seller_phone,
                'Бонус за подключение продавца +' || v_conn.seller_phone,
                'Пакетное начисление за ' || v_target_month,
                'paid',
                COALESCE(v_admin_id, v_conn.manager_id)
            );
            v_conn_bonus_created := v_conn_bonus_created + 1;
        END IF;
    END LOOP;

    -- ШАГ 2: Проверка и начисление бонусов за ежемесячное сопровождение (accrual_maintenance)
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
                v_existing_maint_accrual := NULL;
                v_existing_maint_payout := NULL;

                SELECT id INTO v_existing_maint_accrual
                FROM public.connection_accruals
                WHERE connection_id = v_conn.connection_id
                  AND accrual_type = 'maintenance'
                  AND settlement_month = v_target_month;

                IF v_existing_maint_accrual IS NULL THEN
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
                    ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;
                END IF;

                SELECT payout_id INTO v_existing_maint_payout
                FROM public.employee_payouts
                WHERE connection_id = v_conn.connection_id
                  AND operation_type = 'accrual_maintenance'
                  AND settlement_month = v_target_month;

                IF v_existing_maint_payout IS NULL THEN
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
                        'Пакетное начисление за ' || v_target_month,
                        'paid',
                        COALESCE(v_admin_id, v_conn.manager_id)
                    );
                    v_maint_bonus_created := v_maint_bonus_created + 1;

                    -- FSM статус
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
        'settlement_month', v_target_month,
        'connection_bonuses_created', v_conn_bonus_created,
        'maintenance_bonuses_created', v_maint_bonus_created,
        'total_created', v_conn_bonus_created + v_maint_bonus_created,
        'message', 'Начислено бонусов за подключение: ' || v_conn_bonus_created || ', за сопровождение: ' || v_maint_bonus_created
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_all_connections_bonuses(VARCHAR) TO authenticated;

-- 5. Обновление процедуры get_employee_payroll_sheet с полной детализацией операций
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
    v_opening_balance NUMERIC(12,2) := 0;
    v_opening_plus NUMERIC(12,2) := 0;
    v_opening_minus NUMERIC(12,2) := 0;

    v_total_accrued NUMERIC(12,2) := 0;
    v_total_deductions NUMERIC(12,2) := 0;
    v_total_paid NUMERIC(12,2) := 0;
    v_closing_balance NUMERIC(12,2) := 0;

    v_accruals JSONB := '[]'::jsonb;
    v_deductions JSONB := '[]'::jsonb;
    v_payouts JSONB := '[]'::jsonb;
    v_operations JSONB := '[]'::jsonb;
BEGIN
    v_target_month := COALESCE(p_month, to_char(now(), 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(now(), 'YYYY-MM');
    END IF;

    -- 1. Сальдо на начало месяца (суммы всех предыдущих операций)
    SELECT 
        COALESCE(SUM(CASE WHEN COALESCE(operation_sign, '+') = '+' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(operation_sign, '-') = '-' THEN amount ELSE 0 END), 0)
    INTO v_opening_plus, v_opening_minus
    FROM public.employee_payouts
    WHERE (user_id = p_employee_id OR employee_id = p_employee_id)
      AND COALESCE(settlement_month, accrual_month) < v_target_month;

    v_opening_balance := v_opening_plus - v_opening_minus;

    -- 2. Детализация начислений за расчетный месяц (sign = '+')
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'payout_id', p.payout_id,
                'actual_date', p.actual_date,
                'settlement_month', p.settlement_month,
                'operation_type', p.operation_type,
                'operation_sign', '+',
                'amount', p.amount,
                'note', COALESCE(p.note, p.comment, p.description, 'Начисление'),
                'seller_phone', p.seller_phone,
                'connection_id', p.connection_id
            ) ORDER BY p.actual_date ASC, p.created_at ASC
        ), '[]'::jsonb),
        COALESCE(SUM(p.amount), 0)
    INTO v_accruals, v_total_accrued
    FROM public.employee_payouts p
    WHERE (p.user_id = p_employee_id OR p.employee_id = p_employee_id)
      AND COALESCE(p.settlement_month, p.accrual_month) = v_target_month
      AND (
          p.operation_sign = '+' 
          OR p.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance')
      );

    -- 3. Детализация удержаний, штрафов и авансов за месяц (sign = '-', type IN ('deduction', 'fine', 'advance'))
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'payout_id', p.payout_id,
                'actual_date', p.actual_date,
                'settlement_month', p.settlement_month,
                'operation_type', p.operation_type,
                'operation_sign', '-',
                'amount', p.amount,
                'payment_method', p.payment_method,
                'note', COALESCE(p.note, p.comment, p.description, 'Удержание/Аванс'),
                'seller_phone', p.seller_phone
            ) ORDER BY p.actual_date ASC, p.created_at ASC
        ), '[]'::jsonb),
        COALESCE(SUM(p.amount), 0)
    INTO v_deductions, v_total_deductions
    FROM public.employee_payouts p
    WHERE (p.user_id = p_employee_id OR p.employee_id = p_employee_id)
      AND COALESCE(p.settlement_month, p.accrual_month) = v_target_month
      AND p.operation_type IN ('deduction', 'fine', 'advance');

    -- 4. Детализация выплат за месяц (sign = '-', type = 'payout')
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'payout_id', p.payout_id,
                'actual_date', p.actual_date,
                'settlement_month', p.settlement_month,
                'operation_type', p.operation_type,
                'operation_sign', '-',
                'amount', p.amount,
                'payment_method', p.payment_method,
                'note', COALESCE(p.note, p.comment, p.description, 'Выплата зарплаты'),
                'seller_phone', p.seller_phone
            ) ORDER BY p.actual_date ASC, p.created_at ASC
        ), '[]'::jsonb),
        COALESCE(SUM(p.amount), 0)
    INTO v_payouts, v_total_paid
    FROM public.employee_payouts p
    WHERE (p.user_id = p_employee_id OR p.employee_id = p_employee_id)
      AND COALESCE(p.settlement_month, p.accrual_month) = v_target_month
      AND p.operation_type = 'payout';

    -- Все операции за период для совместимости
    SELECT 
        COALESCE(jsonb_agg(
            row_to_json(p)
            ORDER BY p.actual_date ASC, p.created_at ASC
        ), '[]'::jsonb)
    INTO v_operations
    FROM public.employee_payouts p
    WHERE (p.user_id = p_employee_id OR p.employee_id = p_employee_id)
      AND COALESCE(p.settlement_month, p.accrual_month) = v_target_month;

    -- Исходящий остаток (Сальдо на конец)
    v_closing_balance := v_opening_balance + v_total_accrued - v_total_deductions - v_total_paid;

    RETURN jsonb_build_object(
        'employee_id', p_employee_id,
        'settlement_month', v_target_month,
        'month', v_target_month,
        'opening_balance', v_opening_balance,
        'total_accrued', v_total_accrued,
        'total_deductions', v_total_deductions,
        'total_paid', v_total_paid,
        'closing_balance', v_closing_balance,
        'accruals', v_accruals,
        'deductions_and_advances', v_deductions,
        'payouts', v_payouts,
        'operations', v_operations
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_payroll_sheet(UUID, VARCHAR) TO authenticated;
