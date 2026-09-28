-- ==============================================================================
-- МИГРАЦИЯ 024: Гарантированная синхронизация всех начислений и бонусов в «Операции по ЗП»
-- ==============================================================================

-- 1. Триггерная функция для автоматической синхронизации connection_accruals → employee_payouts
CREATE OR REPLACE FUNCTION public.fn_sync_conn_accrual_to_employee_payout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_op_type VARCHAR(50);
    v_seller_label TEXT;
    v_admin_id UUID;
BEGIN
    -- Определение типа операции в зарплатном регистре
    IF TG_OP = 'DELETE' THEN
        v_op_type := CASE WHEN OLD.accrual_type = 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END;
        
        DELETE FROM public.employee_payouts
        WHERE connection_id = OLD.connection_id
          AND operation_type = v_op_type
          AND (settlement_month = OLD.settlement_month OR accrual_month = OLD.settlement_month);
        
        RETURN OLD;
    END IF;

    v_op_type := CASE WHEN NEW.accrual_type = 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END;

    IF TG_OP = 'UPDATE' THEN
        -- Если обновилась сумма, месяц или статус оплаты
        UPDATE public.employee_payouts
        SET amount = NEW.amount,
            settlement_month = NEW.settlement_month,
            accrual_month = NEW.settlement_month,
            status = CASE WHEN NEW.is_paid THEN 'paid' ELSE 'completed' END,
            note = COALESCE(NEW.notes, note),
            comment = COALESCE(NEW.notes, comment),
            actual_date = COALESCE(NEW.paid_at::date, actual_date, CURRENT_DATE)
        WHERE connection_id = NEW.connection_id
          AND operation_type = v_op_type
          AND (settlement_month = OLD.settlement_month OR accrual_month = OLD.settlement_month);

        -- Если запись для обновления не найдена, вставляем новую
        IF NOT FOUND THEN
            INSERT INTO public.employee_payouts (
                user_id,
                employee_id,
                connection_id,
                seller_phone,
                operation_sign,
                operation_type,
                payout_category,
                amount,
                settlement_month,
                accrual_month,
                actual_date,
                payout_date,
                status,
                note,
                comment,
                created_by
            ) VALUES (
                NEW.employee_id,
                NEW.employee_id,
                NEW.connection_id,
                NEW.seller_phone,
                '+',
                v_op_type,
                'бонус',
                NEW.amount,
                NEW.settlement_month,
                NEW.settlement_month,
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                CASE WHEN NEW.is_paid THEN 'paid' ELSE 'completed' END,
                NEW.notes,
                NEW.notes,
                NEW.employee_id
            );
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Проверяем, существует ли уже такая запись в employee_payouts
        IF NOT EXISTS (
            SELECT 1 FROM public.employee_payouts
            WHERE connection_id = NEW.connection_id
              AND operation_type = v_op_type
              AND (settlement_month = NEW.settlement_month OR accrual_month = NEW.settlement_month)
        ) THEN
            INSERT INTO public.employee_payouts (
                user_id,
                employee_id,
                connection_id,
                seller_phone,
                operation_sign,
                operation_type,
                payout_category,
                amount,
                settlement_month,
                accrual_month,
                actual_date,
                payout_date,
                status,
                note,
                comment,
                created_by
            ) VALUES (
                NEW.employee_id,
                NEW.employee_id,
                NEW.connection_id,
                NEW.seller_phone,
                '+',
                v_op_type,
                'бонус',
                NEW.amount,
                NEW.settlement_month,
                NEW.settlement_month,
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                CASE WHEN NEW.is_paid THEN 'paid' ELSE 'completed' END,
                NEW.notes,
                NEW.notes,
                NEW.employee_id
            );
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

-- 2. Привязка триггера к таблице connection_accruals
DROP TRIGGER IF EXISTS trg_sync_conn_accrual_to_payout ON public.connection_accruals;
CREATE TRIGGER trg_sync_conn_accrual_to_payout
AFTER INSERT OR UPDATE OR DELETE ON public.connection_accruals
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_conn_accrual_to_employee_payout();

-- 3. Триггерная функция очистки при удалении подключения из таблицы connections
CREATE OR REPLACE FUNCTION public.fn_cleanup_connection_payouts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- При физическом удалении подключения удаляем все непогашенные начисления по нему
    DELETE FROM public.employee_payouts
    WHERE connection_id = OLD.connection_id
      AND operation_sign = '+';

    -- Также удаляем из connection_accruals если не удалились каскадом
    DELETE FROM public.connection_accruals
    WHERE connection_id = OLD.connection_id;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_connection_payouts ON public.connections;
CREATE TRIGGER trg_cleanup_connection_payouts
AFTER DELETE ON public.connections
FOR EACH ROW
EXECUTE FUNCTION public.fn_cleanup_connection_payouts();

-- 4. Хранимая процедура самоисцеления и мгновенного бекфилла
CREATE OR REPLACE FUNCTION public.sync_missing_connection_accruals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inserted_count INT := 0;
BEGIN
    INSERT INTO public.employee_payouts (
        user_id,
        employee_id,
        connection_id,
        seller_phone,
        operation_sign,
        operation_type,
        payout_category,
        amount,
        settlement_month,
        accrual_month,
        actual_date,
        payout_date,
        status,
        note,
        comment,
        created_by
    )
    SELECT
        ca.employee_id,
        ca.employee_id,
        ca.connection_id,
        ca.seller_phone,
        '+',
        CASE WHEN ca.accrual_type = 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END,
        'бонус',
        ca.amount,
        ca.settlement_month,
        ca.settlement_month,
        COALESCE(ca.paid_at::date, ca.created_at::date, CURRENT_DATE),
        COALESCE(ca.paid_at::date, ca.created_at::date, CURRENT_DATE),
        CASE WHEN ca.is_paid THEN 'paid' ELSE 'completed' END,
        ca.notes,
        ca.notes,
        ca.employee_id
    FROM public.connection_accruals ca
    WHERE NOT EXISTS (
        SELECT 1 FROM public.employee_payouts ep
        WHERE ep.connection_id = ca.connection_id
          AND ep.operation_type = CASE WHEN ca.accrual_type = 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END
          AND (ep.settlement_month = ca.settlement_month OR ep.accrual_month = ca.settlement_month)
    );

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'synced_count', v_inserted_count,
        'timestamp', now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_missing_connection_accruals() TO authenticated, service_role;

-- 5. Немедленный разовый запуск синхронизации при накате миграции
SELECT public.sync_missing_connection_accruals();
