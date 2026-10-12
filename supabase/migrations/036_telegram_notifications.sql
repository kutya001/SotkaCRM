-- ==============================================================================
-- 036_telegram_notifications.sql
-- Уведомления сотрудников в Telegram.
--  - users: привязанный чат, имя пользователя, настройки видов уведомлений
--  - telegram_link_codes: одноразовые коды привязки (/start <код> в боте)
--  - telegram_outbox: очередь сообщений; наполняется триггерами и отправляется сервером
--  - триггеры: операции по ЗП (начисления, удержания, выплаты), новые подключения,
--    назначенные лиды
-- Таблицы очереди и кодов доступны только service_role.
-- Миграция идемпотентна.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Поля привязки в users
-- ------------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(64);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_prefs JSONB NOT NULL
  DEFAULT '{"payroll": true, "connections": true, "leads": true, "broadcast": true}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_chat_id_unique
  ON public.users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Коды привязки
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code VARCHAR(32) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON public.telegram_link_codes (user_id);

-- ------------------------------------------------------------------------------
-- 3. Очередь сообщений
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,            -- payroll | connections | leads | broadcast | system
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status VARCHAR(10) NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed | skipped
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_telegram_outbox_pending
  ON public.telegram_outbox (created_at) WHERE status IN ('pending', 'sending');

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_link_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.telegram_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_link_codes TO service_role;
GRANT ALL ON TABLE public.telegram_outbox TO service_role;

-- ------------------------------------------------------------------------------
-- 4. Постановка в очередь (с учетом привязки и настроек пользователя)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_enqueue(
  p_user_id UUID,
  p_kind TEXT,
  p_title TEXT,
  p_body TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_title IS NULL OR p_title = '' THEN
    RETURN NULL;
  END IF;

  SELECT telegram_chat_id, is_active, telegram_prefs
  INTO v_user
  FROM public.users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_user.telegram_chat_id IS NULL OR NOT v_user.is_active THEN
    RETURN NULL;
  END IF;

  IF COALESCE((v_user.telegram_prefs ->> p_kind)::boolean, true) = false THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.telegram_outbox (user_id, kind, title, body)
  VALUES (p_user_id, p_kind, p_title, COALESCE(p_body, ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_enqueue(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_enqueue(UUID, TEXT, TEXT, TEXT) TO service_role;

-- Сумма для сообщений: 1500.00 → 1500, 1500.50 → 1500.50
CREATE OR REPLACE FUNCTION public.telegram_format_amount(p_amount NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(to_char(COALESCE(p_amount, 0), 'FM999999999990.00'), '\.00$', '');
$$;

-- ------------------------------------------------------------------------------
-- 5. Захват пачки сообщений для отправки (несколько отправителей не дублируют друг друга)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_claim_outbox(p_limit INT DEFAULT 50)
RETURNS SETOF public.telegram_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.telegram_outbox o
  SET status = 'sending',
      attempts = o.attempts + 1,
      claimed_at = now()
  WHERE o.id IN (
    SELECT id FROM public.telegram_outbox
    WHERE status = 'pending'
       OR (status = 'sending' AND claimed_at < now() - INTERVAL '10 minutes')
    ORDER BY created_at
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_claim_outbox(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_claim_outbox(INT) TO service_role;

-- ------------------------------------------------------------------------------
-- 6. Привязка аккаунта по коду из бота
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_link_account(
  p_code TEXT,
  p_chat_id BIGINT,
  p_username TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code RECORD;
  v_user RECORD;
BEGIN
  IF p_code IS NULL OR p_chat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_not_found');
  END IF;

  SELECT * INTO v_code
  FROM public.telegram_link_codes
  WHERE code = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_not_found');
  END IF;
  IF v_code.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_used');
  END IF;
  IF v_code.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_expired');
  END IF;

  SELECT user_id, full_name, role, is_active INTO v_user
  FROM public.users
  WHERE user_id = v_code.user_id;

  IF NOT FOUND OR NOT v_user.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_inactive');
  END IF;

  -- Один чат — один сотрудник
  UPDATE public.users
  SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL
  WHERE telegram_chat_id = p_chat_id AND user_id <> v_code.user_id;

  UPDATE public.users
  SET telegram_chat_id = p_chat_id,
      telegram_username = NULLIF(trim(COALESCE(p_username, '')), ''),
      telegram_linked_at = now()
  WHERE user_id = v_code.user_id;

  UPDATE public.telegram_link_codes SET used_at = now() WHERE code = v_code.code;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user.user_id,
    'full_name', v_user.full_name,
    'role', v_user.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_link_account(TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_link_account(TEXT, BIGINT, TEXT) TO service_role;

-- ------------------------------------------------------------------------------
-- 7. Триггеры-источники событий
-- ------------------------------------------------------------------------------

-- 7.1. Операции по ЗП: начисления, удержания, выплаты
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
  v_amount := public.telegram_format_amount(NEW.amount);
  v_kind_label := CASE NEW.operation_type
    WHEN 'accrual_connection' THEN 'Бонус за подключение'
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
    WHEN NEW.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance')
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.employee_payouts'::regclass AND tgname = 'trg_telegram_on_payout'
  ) THEN
    CREATE TRIGGER trg_telegram_on_payout
    AFTER INSERT ON public.employee_payouts
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_telegram_on_payout();
  END IF;
END $$;

-- 7.2. Подключения: новое подключение или передача куратору
CREATE OR REPLACE FUNCTION public.trg_telegram_on_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_fee NUMERIC(12, 2);
  v_body TEXT;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id THEN
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
    || CASE WHEN v_plan IS NOT NULL THEN E'\nТариф: ' || v_plan ELSE '' END
    || E'\nБонус за подключение: ' || public.telegram_format_amount(v_fee) || ' сом'
    || E'\nМесяц начисления: ' || COALESCE(NEW.accrual_month, '—');

  PERFORM public.telegram_enqueue(
    NEW.manager_id,
    'connections',
    CASE WHEN TG_OP = 'INSERT' THEN 'Новое подключение' ELSE 'Вам передано подключение' END,
    v_body
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connections'::regclass AND tgname = 'trg_telegram_on_connection'
  ) THEN
    CREATE TRIGGER trg_telegram_on_connection
    AFTER INSERT OR UPDATE OF manager_id ON public.connections
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_telegram_on_connection();
  END IF;
END $$;

-- 7.3. Лиды: назначение консультанту (самоназначение не уведомляется)
CREATE OR REPLACE FUNCTION public.trg_telegram_on_lead_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_body TEXT;
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to = public.get_current_crm_user_id() THEN
    RETURN NEW;
  END IF;

  v_phone := regexp_replace(COALESCE(NEW.country_code, '') || COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
  v_body := 'Клиент: ' || COALESCE(NULLIF(NEW.client_name, ''), '—')
    || E'\nТелефон: ' || CASE WHEN v_phone <> '' THEN '+' || v_phone ELSE '—' END
    || E'\nСтатус: ' || NEW.status::text
    || CASE WHEN COALESCE(NEW.instagram, '') <> '' THEN E'\nInstagram: ' || NEW.instagram ELSE '' END
    || CASE WHEN COALESCE(NEW.comment, '') <> '' THEN E'\nКомментарий: ' || left(NEW.comment, 300) ELSE '' END;

  PERFORM public.telegram_enqueue(NEW.assigned_to, 'leads', 'Вам назначен лид', v_body);
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.leads'::regclass AND tgname = 'trg_telegram_on_lead_assigned'
  ) THEN
    CREATE TRIGGER trg_telegram_on_lead_assigned
    AFTER INSERT OR UPDATE OF assigned_to ON public.leads
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_telegram_on_lead_assigned();
  END IF;
END $$;
