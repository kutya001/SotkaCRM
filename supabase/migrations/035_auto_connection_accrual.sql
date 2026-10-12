-- ==============================================================================
-- 035_auto_connection_accrual.sql
-- Начисление за подключение создается автоматически в момент подключения:
-- при создании записи в connections с куратором или при назначении куратора позже.
-- Сопровождение по-прежнему начисляется только процедурой, которую запускает
-- администратор (accrue_connection_bonuses_v2 / accrue_selected_connections /
-- run_maintenance_billing), и только со следующего месяца после подключения (034).
-- Миграция идемпотентна.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_connection_auto_accrual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee NUMERIC(12, 2);
  v_rate NUMERIC(12, 2);
  v_month VARCHAR(7);
  v_label TEXT;
  v_seller_store TEXT;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Повторное срабатывание только при смене куратора или статуса
  IF TG_OP = 'UPDATE'
     AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status, '') IN ('отменен', 'отменён') OR NEW.client_status::text = 'отменен' THEN
    RETURN NEW;
  END IF;

  -- Начисление за подключение по этому подключению уже есть
  IF EXISTS (
    SELECT 1 FROM public.employee_payouts
    WHERE connection_id = NEW.connection_id AND operation_type = 'accrual_connection'
  ) THEN
    RETURN NEW;
  END IF;

  -- Ставка за подключение: как в accrue_connection_bonuses_v2
  v_fee := COALESCE(NULLIF(NEW.connection_fee, 0), NULLIF(NEW.connection_fee_amount, 0), 0);
  IF v_fee <= 0 AND COALESCE(NEW.plan_price, 0) > 0 THEN
    v_fee := ROUND(NEW.plan_price * COALESCE(NEW.connection_fee_percent, 30) / 100);
  END IF;
  IF v_fee <= 0 THEN
    SELECT COALESCE(rate_amount, 0) INTO v_rate
    FROM public.rates
    WHERE rate_type IN ('fixed', 'connection')
    ORDER BY created_at DESC LIMIT 1;
    v_fee := CASE WHEN COALESCE(v_rate, 0) > 0 THEN v_rate ELSE 500.00 END;
  END IF;

  v_month := COALESCE(NULLIF(NEW.accrual_month, ''), to_char(CURRENT_DATE, 'YYYY-MM'));

  -- Порядок начислений (034): подключение не позже уже начисленного сопровождения
  IF public.payroll_connection_order_error('accrual_connection', v_month, NEW.seller_phone, NEW.connection_id) IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.store INTO v_seller_store FROM public.sellers s WHERE s.seller_phone = NEW.seller_phone;
  v_label := 'Бонус за подключение: '
    || COALESCE(NULLIF(v_seller_store, ''), NULLIF(NEW.store, ''), NULLIF(NEW.seller_name, ''), 'контрагент');

  INSERT INTO public.employee_payouts (
    user_id, employee_id, connection_id, seller_phone, seller_id,
    operation_sign, operation_type, payout_category, payment_method, amount,
    settlement_month, accrual_month, actual_date, payout_date, status,
    note, comment, created_by
  ) VALUES (
    NEW.manager_id, NEW.manager_id, NEW.connection_id, NEW.seller_phone, NEW.seller_phone,
    '+', 'accrual_connection', 'бонус', 'система', v_fee,
    v_month, v_month, CURRENT_DATE, CURRENT_DATE, 'completed',
    v_label, v_label, COALESCE(NEW.assigned_by, NEW.manager_id)
  );

  -- Реестр начислений подключений: триггер синхронизации увидит готовую проводку и не продублирует ее
  INSERT INTO public.connection_accruals (
    connection_id, seller_phone, employee_id, accrual_type, settlement_month, amount, is_paid, notes
  ) VALUES (
    NEW.connection_id, NEW.seller_phone, NEW.manager_id, 'connection', v_month, v_fee, false, v_label
  )
  ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

  -- Фактическая ставка сохраняется в подключении (как делает массовое начисление)
  UPDATE public.connections
  SET connection_fee = v_fee,
      connection_fee_amount = COALESCE(NULLIF(connection_fee_amount, 0), v_fee)
  WHERE connection_id = NEW.connection_id
    AND (COALESCE(connection_fee, 0) <= 0 OR COALESCE(connection_fee_amount, 0) <= 0);

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connections'::regclass AND tgname = 'trg_connection_auto_accrual'
  ) THEN
    CREATE TRIGGER trg_connection_auto_accrual
    AFTER INSERT OR UPDATE OF manager_id, status ON public.connections
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_connection_auto_accrual();
  END IF;
END $$;
