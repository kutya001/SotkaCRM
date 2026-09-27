-- ==============================================================================
-- МИГРАЦИЯ 020: Разрешение Hard-delete лидов для Admin и Единые начисления
-- ==============================================================================

-- 1. Триггерная функция проверки прав на физическое удаление лидов
CREATE OR REPLACE FUNCTION public.check_lead_deletion_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  -- Получаем роль текущего авторизованного пользователя
  v_user_role := public.get_current_user_role();

  IF v_user_role IS NULL THEN
    SELECT role INTO v_user_role 
    FROM public.users 
    WHERE auth_id = auth.uid() OR user_id = auth.uid();
  END IF;

  -- Разрешаем физическое удаление СТРОГО роли admin
  IF v_user_role = 'admin' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Удаление записей лидов разрешено только администратору';
END;
$$;

-- Снятие старых безусловных блокировок и установка триггера проверки
DROP TRIGGER IF EXISTS prevent_lead_delete ON public.leads;
DROP TRIGGER IF EXISTS trg_prevent_lead_delete ON public.leads;
DROP TRIGGER IF EXISTS trg_check_lead_delete ON public.leads;

CREATE TRIGGER trg_check_lead_delete
BEFORE DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.check_lead_deletion_permission();

-- Обновление RLS политики на физическое удаление лидов
DROP POLICY IF EXISTS "leads_delete_policy" ON public.leads;
DROP POLICY IF EXISTS "leads_admin_delete" ON public.leads;

CREATE POLICY "leads_delete_policy" ON public.leads
FOR DELETE TO authenticated
USING (
  (SELECT public.get_current_user_role()) = 'admin'
);

-- 2. Единая RPC-функция автоматических начислений process_unified_connection_accruals
CREATE OR REPLACE FUNCTION public.process_unified_connection_accruals(
    p_settlement_month VARCHAR(7) DEFAULT NULL,
    p_accrual_type VARCHAR(20) DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_month VARCHAR(7);
    v_type VARCHAR(20);
    v_conn RECORD;
    v_admin_id UUID;
    v_connection_bonuses_created INT := 0;
    v_maintenance_bonuses_created INT := 0;
    v_exists BOOLEAN;
    v_new_accrued_count INT;
    v_new_status VARCHAR(50);
BEGIN
    v_target_month := COALESCE(p_settlement_month, to_char(now(), 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(now(), 'YYYY-MM');
    END IF;

    v_type := COALESCE(p_accrual_type, 'all');

    SELECT user_id INTO v_admin_id FROM public.users WHERE role = 'admin' LIMIT 1;

    -- Проходим по всем активным подключениям с назначенным куратором
    FOR v_conn IN 
        SELECT 
            c.connection_id,
            c.seller_phone,
            c.manager_id,
            c.status,
            c.assigned_at,
            c.accrual_month,
            COALESCE(c.connection_fee, c.connection_fee_amount, round(c.plan_price * COALESCE(c.connection_fee_percent, 30.0) / 100.0, 2)) AS conn_fee,
            COALESCE(c.maintenance_fee_monthly, round(c.plan_price * 10.0 / 100.0, 2)) AS maint_fee,
            COALESCE(c.maintenance_month_start, to_char((c.assigned_at + INTERVAL '1 month'), 'YYYY-MM')) AS maintenance_month_start,
            COALESCE(c.maintenance_months_total, 2) AS maintenance_months_total,
            COALESCE(c.maintenance_months_accrued, 0) AS maintenance_months_accrued,
            s.is_active AS seller_active 
        FROM public.connections c
        JOIN public.sellers s ON s.seller_phone = c.seller_phone
        WHERE c.manager_id IS NOT NULL AND s.is_active = true
    LOOP
        -- А. Проверка и начисление бонуса за подключение (если ранее не начислялся)
        IF v_type IN ('all', 'connection') THEN
            SELECT EXISTS(
                SELECT 1 FROM public.connection_accruals 
                WHERE connection_id = v_conn.connection_id AND accrual_type = 'connection'
            ) INTO v_exists;

            IF NOT v_exists AND COALESCE(v_conn.conn_fee, 0) > 0 THEN
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
                    COALESCE(v_conn.accrual_month, v_target_month),
                    v_conn.conn_fee,
                    false,
                    'Бонус за подключение контрагента'
                ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

                -- Безопасная попытка зарегистрировать операцию в employee_payouts (если таблица готова)
                BEGIN
                    INSERT INTO public.employee_payouts (
                        user_id,
                        created_by,
                        amount,
                        payout_category,
                        operation_type,
                        settlement_month,
                        accrual_month,
                        payout_date,
                        payment_method,
                        comment
                    ) VALUES (
                        v_conn.manager_id,
                        COALESCE(v_admin_id, v_conn.manager_id),
                        v_conn.conn_fee,
                        'бонус',
                        'payout',
                        COALESCE(v_conn.accrual_month, v_target_month),
                        COALESCE(v_conn.accrual_month, v_target_month),
                        CURRENT_DATE,
                        'система',
                        'Бонус за подключение контрагента +' || v_conn.seller_phone
                    );
                EXCEPTION WHEN OTHERS THEN
                    -- Игнорируем ошибки при вставке в employee_payouts, так как connection_accruals является основным реестром
                    NULL;
                END;

                v_connection_bonuses_created := v_connection_bonuses_created + 1;
            END IF;
        END IF;

        -- Б. Проверка и начисление бонуса за сопровождение за выбранный месяц
        IF v_type IN ('all', 'maintenance') THEN
            SELECT EXISTS(
                SELECT 1 FROM public.connection_accruals 
                WHERE connection_id = v_conn.connection_id 
                  AND accrual_type = 'maintenance' 
                  AND settlement_month = v_target_month
            ) INTO v_exists;

            -- Начисляем, если в этом месяце еще не было начисления, сопровождение началось и лимит не исчерпан
            IF NOT v_exists AND COALESCE(v_conn.maint_fee, 0) > 0 
               AND (v_conn.maintenance_month_start IS NULL OR v_target_month >= v_conn.maintenance_month_start)
               AND (v_conn.status != 'готов' AND v_conn.maintenance_months_accrued < v_conn.maintenance_months_total) THEN
              
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
                    v_conn.maint_fee,
                    false,
                    'Бонус за сопровождение за месяц ' || v_target_month
                ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

                -- Безопасная попытка зарегистрировать операцию в employee_payouts
                BEGIN
                    INSERT INTO public.employee_payouts (
                        user_id,
                        created_by,
                        amount,
                        payout_category,
                        operation_type,
                        settlement_month,
                        accrual_month,
                        payout_date,
                        payment_method,
                        comment
                    ) VALUES (
                        v_conn.manager_id,
                        COALESCE(v_admin_id, v_conn.manager_id),
                        v_conn.maint_fee,
                        'бонус',
                        'payout',
                        v_target_month,
                        v_target_month,
                        CURRENT_DATE,
                        'система',
                        'Бонус за сопровождение за месяц ' || v_target_month || ' по +' || v_conn.seller_phone
                    );
                EXCEPTION WHEN OTHERS THEN
                    NULL;
                END;

                v_new_accrued_count := v_conn.maintenance_months_accrued + 1;
                IF v_new_accrued_count >= v_conn.maintenance_months_total THEN
                    v_new_status := 'готов';
                ELSE
                    v_new_status := 'сопровождение';
                END IF;

                UPDATE public.connections 
                SET status = v_new_status,
                    client_status = v_new_status::client_lifecycle_status,
                    maintenance_months_accrued = v_new_accrued_count
                WHERE connection_id = v_conn.connection_id;

                v_maintenance_bonuses_created := v_maintenance_bonuses_created + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'settlement_month', v_target_month,
        'accrual_type', v_type,
        'connection_bonuses_created', v_connection_bonuses_created,
        'maintenance_bonuses_created', v_maintenance_bonuses_created,
        'total_created', v_connection_bonuses_created + v_maintenance_bonuses_created,
        'message', CASE 
            WHEN v_type = 'connection' THEN 'Начислено бонусов за подключение: ' || v_connection_bonuses_created
            WHEN v_type = 'maintenance' THEN 'Начислено бонусов за сопровождение: ' || v_maintenance_bonuses_created
            ELSE 'Начислено бонусов за подключение: ' || v_connection_bonuses_created || ', за сопровождение: ' || v_maintenance_bonuses_created
        END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_unified_connection_accruals(VARCHAR, VARCHAR) TO authenticated;

-- Синоним с 1 параметром
CREATE OR REPLACE FUNCTION public.process_unified_connection_accruals(
    p_settlement_month VARCHAR(7)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.process_unified_connection_accruals(p_settlement_month, 'all');
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_unified_connection_accruals(VARCHAR) TO authenticated;

-- Синоним для полной обратной совместимости
CREATE OR REPLACE FUNCTION public.accrue_all_connections_bonuses(
    p_settlement_month VARCHAR(7) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.process_unified_connection_accruals(p_settlement_month, 'all');
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_all_connections_bonuses(VARCHAR) TO authenticated;
