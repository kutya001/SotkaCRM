-- ==============================================================================
-- 038_telegram_confirmation_and_cascade_cleanup.sql
-- 1. Telegram: уведомление о начислении за подключение не отправляется (о подключении
--    уже уходит сообщение); подтвержденное подключение приходит консультанту как
--    «Подключение подтверждено».
-- 2. Каскадная очистка: удаление подключения чистит начисления (BEFORE DELETE — до
--    того, как внешний ключ обнулит connection_id в операциях по ЗП); удаление продавца
--    отвязывает лиды и удаляет подключения с начислениями; снятие куратора у продавца
--    удаляет его подключение (кроме отклоненных — они остаются как история).
-- Миграция идемпотентна.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Telegram
-- ------------------------------------------------------------------------------

-- 1.1. Операции по ЗП: бонус за подключение не дублирует уведомление о подключении
CREATE OR REPLACE FUNCTION public.trg_telegram_on_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind_label TEXT;
  v_title TEXT;
  v_body TEXT;
  v_amount TEXT;
BEGIN
  -- О подключении консультант уже уведомлен («Подключение подтверждено»)
  IF NEW.operation_type = 'accrual_connection' THEN
    RETURN NEW;
  END IF;

  v_amount := public.telegram_format_amount(NEW.amount);
  v_kind_label := CASE NEW.operation_type
    WHEN 'accrual_maintenance' THEN 'Бонус за сопровождение'
    WHEN 'salary_base' THEN 'Оклад'
    WHEN 'bonus_other' THEN 'Премия'
    WHEN 'deduction' THEN 'Удержание'
    WHEN 'fine' THEN 'Штраф'
    WHEN 'payout' THEN 'Выплата зарплаты'
    WHEN 'advance' THEN 'Аванс'
    ELSE COALESCE(NEW.operation_type, 'Операция')
  END;

  v_title := CASE
    WHEN NEW.operation_type IN ('salary_base', 'bonus_other', 'accrual_maintenance')
      THEN 'Начислено +' || v_amount || ' сом'
    WHEN NEW.operation_type IN ('deduction', 'fine')
      THEN 'Удержано −' || v_amount || ' сом'
    ELSE 'Выплачено ' || v_amount || ' сом'
  END;

  v_body := 'Вид: ' || v_kind_label
    || E'\nРасчетный месяц: ' || COALESCE(NULLIF(NEW.settlement_month, ''), NEW.accrual_month, '—')
    || CASE WHEN COALESCE(NEW.note, NEW.comment, '') <> ''
         THEN E'\nОснование: ' || left(COALESCE(NEW.note, NEW.comment), 300)
         ELSE '' END;

  PERFORM public.telegram_enqueue(COALESCE(NEW.employee_id, NEW.user_id), 'payroll', v_title, v_body);
  RETURN NEW;
END;
$$;

-- 1.2. Подключения: консультанту — «Подключение подтверждено», администраторам — «ожидает подтверждения»
CREATE OR REPLACE FUNCTION public.trg_telegram_on_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_fee NUMERIC(12, 2);
  v_manager_name TEXT;
  v_confirmer_name TEXT;
  v_body TEXT;
  v_admin RECORD;
  v_confirmation_changed BOOLEAN := FALSE;
  v_manager_changed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_confirmation_changed := NEW.confirmation_status IS DISTINCT FROM OLD.confirmation_status;
    v_manager_changed := NEW.manager_id IS DISTINCT FROM OLD.manager_id;
    IF NOT v_confirmation_changed AND NOT v_manager_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan_name INTO v_plan FROM public.plans WHERE plan_id = NEW.plan_id;
  SELECT full_name INTO v_manager_name FROM public.users WHERE user_id = NEW.manager_id;
  v_fee := COALESCE(
    NULLIF(NEW.connection_fee, 0),
    NULLIF(NEW.connection_fee_amount, 0),
    ROUND(COALESCE(NEW.plan_price, 0) * COALESCE(NEW.connection_fee_percent, 30) / 100)
  );

  v_body := 'Продавец: ' || COALESCE(NULLIF(NEW.seller_name, ''), '—')
    || E'\nТелефон: +' || NEW.seller_phone
    || E'\nМагазин: ' || COALESCE(NULLIF(NEW.store, ''), '—')
    || CASE WHEN v_plan IS NOT NULL THEN E'\nТариф: ' || v_plan ELSE '' END
    || E'\nБонус за подключение: ' || public.telegram_format_amount(v_fee) || ' сом'
    || E'\nМесяц начисления: ' || COALESCE(NEW.accrual_month, '—');

  -- Отклонение: консультанту с причиной
  IF TG_OP = 'UPDATE' AND v_confirmation_changed AND NEW.confirmation_status = 'rejected' THEN
    PERFORM public.telegram_enqueue(
      NEW.manager_id, 'connections', 'Подключение отклонено',
      v_body || CASE WHEN COALESCE(NEW.rejection_reason, '') <> '' THEN E'\nПричина: ' || left(NEW.rejection_reason, 300) ELSE '' END
    );
    RETURN NEW;
  END IF;

  -- Ожидает подтверждения: всем администраторам с привязанным Telegram
  IF NEW.confirmation_status = 'pending' THEN
    FOR v_admin IN
      SELECT user_id FROM public.users
      WHERE role = 'admin' AND is_active = true AND telegram_chat_id IS NOT NULL
    LOOP
      PERFORM public.telegram_enqueue(
        v_admin.user_id, 'connections', 'Подключение ожидает подтверждения',
        'Консультант: ' || COALESCE(v_manager_name, '—') || E'\n' || v_body
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.confirmation_status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Подтвержденное подключение (назначено администратором, подтверждено после «Взять себе»
  -- или передано другому куратору) — одно сообщение консультанту
  IF NEW.confirmed_by IS NOT NULL AND NEW.confirmed_by <> NEW.manager_id THEN
    SELECT full_name INTO v_confirmer_name FROM public.users WHERE user_id = NEW.confirmed_by;
  END IF;

  PERFORM public.telegram_enqueue(
    NEW.manager_id,
    'connections',
    'Подключение подтверждено',
    v_body || CASE WHEN v_confirmer_name IS NOT NULL THEN E'\nПодтвердил: ' || v_confirmer_name ELSE '' END
  );
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Каскадная очистка
-- ------------------------------------------------------------------------------

-- 2.1. Удаление подключения: начисления куратора удаляются ДО того, как внешний ключ
--      employee_payouts.connection_id (ON DELETE SET NULL) обнулит ссылку
CREATE OR REPLACE FUNCTION public.fn_cleanup_connection_payouts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.employee_payouts
  WHERE connection_id = OLD.connection_id
    AND (operation_type IN ('accrual_connection', 'accrual_maintenance') OR operation_sign = '+');

  DELETE FROM public.connection_accruals
  WHERE connection_id = OLD.connection_id;

  RETURN OLD;
END;
$$;

-- CREATE OR REPLACE меняет момент срабатывания существующего триггера (AFTER → BEFORE)
CREATE OR REPLACE TRIGGER trg_cleanup_connection_payouts
BEFORE DELETE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.fn_cleanup_connection_payouts();

-- 2.2. Удаление продавца: лиды отвязываются, подключения (и их начисления) удаляются
CREATE OR REPLACE FUNCTION public.fn_seller_cascade_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
  SET seller_phone = NULL,
      linked_at = NULL,
      status = CASE WHEN status = 'Подписан' THEN 'Назначен'::lead_status ELSE status END,
      updated_at = now()
  WHERE seller_phone = OLD.seller_phone;

  DELETE FROM public.connections WHERE seller_phone = OLD.seller_phone;

  -- Начисления куратора по этому продавцу без ссылки на подключение
  DELETE FROM public.employee_payouts
  WHERE seller_phone = OLD.seller_phone
    AND operation_type IN ('accrual_connection', 'accrual_maintenance');

  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_seller_cascade_cleanup
BEFORE DELETE ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.fn_seller_cascade_cleanup();

-- 2.3. Снятие куратора у продавца: подключение куратора удаляется вместе с начислениями.
--      Отклоненные подключения сохраняются как история (куратор снимается при отклонении).
CREATE OR REPLACE FUNCTION public.fn_seller_manager_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.manager_id IS NULL AND OLD.manager_id IS NOT NULL THEN
    DELETE FROM public.connections
    WHERE seller_phone = NEW.seller_phone
      AND confirmation_status <> 'rejected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_seller_manager_removed
AFTER UPDATE OF manager_id ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.fn_seller_manager_removed();

NOTIFY pgrst, 'reload schema';
