-- ==============================================================================
-- 044_telegram_connection_flow.sql
-- Telegram по подключениям (043: участники и сопровождение):
--  - до подтверждения участники не уведомляются; запрос на подтверждение администраторам
--    формирует сервер (полная информация, список участников, одноразовая ссылка подтверждения);
--  - после подтверждения каждому участнику — «Подключение подтверждено» с суммой его доли;
--  - добавление участника уведомляет его только по подтвержденному подключению (с долей);
--  - назначение сопровождения не уведомляет; сопровождение — одним сообщением при начислении
--    (формирует сервер), построчные уведомления о проводках сопровождения отключены;
--  - одноразовые ссылки подтверждения: telegram_connection_confirmations (хранится хеш).
-- Миграция идемпотентна.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Одноразовые ссылки подтверждения подключения (администратору в Telegram)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_connection_confirmations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tg_conn_confirm_connection ON public.telegram_connection_confirmations (connection_id);

ALTER TABLE public.telegram_connection_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_connection_confirmations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_connection_confirmations TO service_role;

-- ------------------------------------------------------------------------------
-- 2. Подключение: pending — без уведомлений из БД (запрос администраторам шлет сервер);
--    confirmed — каждому участнику с его долей; rejected — всем участникам с причиной
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_telegram_on_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_fee NUMERIC(12, 2);
  v_confirmer_name TEXT;
  v_body TEXT;
  v_users UUID[];
  v_n INT;
  v_i INT;
  v_share NUMERIC(12, 2);
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

  -- Ожидает подтверждения: участников не беспокоим, администраторам запрос формирует сервер
  IF NEW.confirmation_status = 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT plan_name INTO v_plan FROM public.plans WHERE plan_id = NEW.plan_id;
  v_fee := COALESCE(
    NULLIF(NEW.connection_fee, 0),
    NULLIF(NEW.connection_fee_amount, 0),
    ROUND(COALESCE(NEW.plan_price, 0) * COALESCE(NEW.connection_fee_percent, 30) / 100)
  );

  v_body := 'Продавец: ' || COALESCE(NULLIF(NEW.seller_name, ''), '—')
    || E'\nТелефон: +' || NEW.seller_phone
    || E'\nМагазин: ' || COALESCE(NULLIF(NEW.store, ''), '—')
    || CASE WHEN v_plan IS NOT NULL THEN E'\nТариф: ' || v_plan ELSE '' END;

  v_users := public.connection_participants_of(NEW.connection_id);
  v_n := COALESCE(cardinality(v_users), 0);
  IF v_n = 0 THEN
    v_users := ARRAY[NEW.manager_id];
    v_n := 1;
  END IF;

  -- Отклонение: всем участникам с причиной
  IF TG_OP = 'UPDATE' AND v_confirmation_changed AND NEW.confirmation_status = 'rejected' THEN
    FOR v_i IN 1..v_n LOOP
      PERFORM public.telegram_enqueue(
        v_users[v_i], 'connections', 'Подключение отклонено',
        v_body || CASE WHEN COALESCE(NEW.rejection_reason, '') <> '' THEN E'\nПричина: ' || left(NEW.rejection_reason, 300) ELSE '' END
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.confirmation_status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Смена основного по уже подтвержденному подключению: уведомляется только новый основной
  IF TG_OP = 'UPDATE' AND NOT v_confirmation_changed AND v_manager_changed THEN
    v_users := ARRAY[NEW.manager_id];
    v_n := 1;
  END IF;

  IF NEW.confirmed_by IS NOT NULL THEN
    SELECT full_name INTO v_confirmer_name FROM public.users WHERE user_id = NEW.confirmed_by;
  END IF;

  -- Подтверждено: каждому участнику его начисленная доля (проводки созданы триггером начисления)
  FOR v_i IN 1..v_n LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_share
    FROM public.employee_payouts
    WHERE connection_id = NEW.connection_id
      AND operation_type = 'accrual_connection'
      AND operation_sign = '+'
      AND COALESCE(employee_id, user_id) = v_users[v_i];
    IF COALESCE(v_share, 0) <= 0 THEN
      v_share := public.connection_split_amount(v_fee, v_n, v_i);
    END IF;

    PERFORM public.telegram_enqueue(
      v_users[v_i],
      'connections',
      'Подключение подтверждено',
      v_body
        || E'\nНачислено: +' || public.telegram_format_amount(v_share) || ' сом'
        || CASE WHEN v_n > 1 THEN ' (ваша доля 1/' || v_n || ' от ' || public.telegram_format_amount(v_fee) || ' сом)' ELSE '' END
        || E'\nМесяц начисления: ' || COALESCE(NEW.accrual_month, '—')
        || CASE WHEN v_confirmer_name IS NOT NULL AND NEW.confirmed_by <> v_users[v_i] THEN E'\nПодтвердил: ' || v_confirmer_name ELSE '' END
    );
  END LOOP;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Участник добавлен: уведомление только по подтвержденному подключению, с его долей
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_telegram_on_participant_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD;
  v_adder TEXT;
  v_n INT;
  v_share NUMERIC(12, 2);
BEGIN
  IF NEW.added_by IS NOT NULL AND NEW.added_by = NEW.user_id THEN
    RETURN NEW;
  END IF;
  SELECT c.seller_name, c.seller_phone, c.store, c.confirmation_status, c.accrual_month
  INTO v_conn
  FROM public.connections c WHERE c.connection_id = NEW.connection_id;
  IF NOT FOUND OR COALESCE(v_conn.confirmation_status, 'confirmed') <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  v_n := COALESCE(cardinality(public.connection_participants_of(NEW.connection_id)), 1);
  SELECT COALESCE(SUM(amount), 0) INTO v_share
  FROM public.employee_payouts
  WHERE connection_id = NEW.connection_id
    AND operation_type = 'accrual_connection'
    AND operation_sign = '+'
    AND COALESCE(employee_id, user_id) = NEW.user_id;
  IF NEW.added_by IS NOT NULL THEN
    SELECT full_name INTO v_adder FROM public.users WHERE user_id = NEW.added_by;
  END IF;

  PERFORM public.telegram_enqueue(
    NEW.user_id,
    'connections',
    'Вы добавлены в подключение',
    'Продавец: ' || COALESCE(NULLIF(v_conn.seller_name, ''), '—')
      || E'\nТелефон: +' || v_conn.seller_phone
      || E'\nМагазин: ' || COALESCE(NULLIF(v_conn.store, ''), '—')
      || E'\nУчастников: ' || v_n || ' — бонусы делятся поровну'
      || CASE WHEN COALESCE(v_share, 0) > 0
           THEN E'\nНачислено: +' || public.telegram_format_amount(v_share) || ' сом (' || COALESCE(v_conn.accrual_month, '—') || ')'
           ELSE '' END
      || CASE WHEN v_adder IS NOT NULL THEN E'\nДобавил: ' || v_adder ELSE '' END
  );
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Назначение сопровождения не уведомляет (сообщение — при начислении, одним списком)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_telegram_on_maintenance_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Проводки ЗП: подключение и сопровождение не уведомляются построчно
--    (подключение — «Подключение подтверждено», сопровождение — сводка от сервера)
-- ------------------------------------------------------------------------------
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
  IF NEW.operation_type IN ('accrual_connection', 'accrual_maintenance') THEN
    RETURN NEW;
  END IF;

  v_amount := public.telegram_format_amount(NEW.amount);
  v_kind_label := CASE NEW.operation_type
    WHEN 'salary_base' THEN 'Оклад'
    WHEN 'bonus_other' THEN 'Премия'
    WHEN 'deduction' THEN 'Удержание'
    WHEN 'fine' THEN 'Штраф'
    WHEN 'payout' THEN 'Выплата зарплаты'
    WHEN 'advance' THEN 'Аванс'
    ELSE COALESCE(NEW.operation_type, 'Операция')
  END;

  v_title := CASE
    WHEN NEW.operation_type IN ('salary_base', 'bonus_other')
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

NOTIFY pgrst, 'reload schema';
