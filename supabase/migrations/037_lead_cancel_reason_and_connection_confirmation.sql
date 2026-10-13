-- ==============================================================================
-- 037_lead_cancel_reason_and_connection_confirmation.sql
-- 1. Лиды: причина отмены обязательна при переводе в «Отмена» (колонки, триггер,
--    политика UPDATE по матрице ролей: admin — всё; smm — свои Открыт/Обработан/Отмена;
--    consultant — свои Назначен/Подписан/Отмена; supervisor — только просмотр).
-- 2. Подключения: подтверждение администратором (confirmation_status pending/confirmed/
--    rejected, confirmed_by/at, rejection_reason, updated_at). Консультант берет продавца
--    сам — подключение pending; начисление за подключение (триггер 035) и процедуры
--    сопровождения (034) работают только по подтвержденным подключениям.
-- 3. link_lead_to_seller: единая реализация с p_confirmation_status; старые перегрузки
--    делегируют в нее; начисления создает только триггер 035 (без дублей).
-- 4. Telegram: администраторам — «ожидает подтверждения», консультанту — «подтверждено/отклонено».
-- Миграция идемпотентна; триггеры пересоздаются через CREATE OR REPLACE TRIGGER (PG14+).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Лиды: причина отмены
-- ------------------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.leads_enforce_cancel_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Отмена' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Отмена' THEN
      IF NULLIF(btrim(COALESCE(NEW.cancel_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Для перевода лида в статус «Отмена» укажите причину'
          USING ERRCODE = 'P0001', HINT = 'cancel_reason_required';
      END IF;
      NEW.cancelled_at := now();
    END IF;
  ELSE
    -- Возврат из «Отмена» (только администратор) очищает причину
    NEW.cancel_reason := NULL;
    NEW.cancelled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_leads_cancel_reason
BEFORE INSERT OR UPDATE OF status, cancel_reason ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_enforce_cancel_reason();

-- Политика UPDATE = матрица ролей (страховка для прямых запросов; API проверяет правила сам)
ALTER POLICY leads_update_policy ON public.leads
USING (
  (SELECT public.get_current_user_role()) = 'admin'::user_role
  OR ((SELECT public.get_current_user_role()) = 'smm'::user_role
      AND created_by = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Открыт'::lead_status, 'Обработан'::lead_status]))
  OR ((SELECT public.get_current_user_role()) = 'consultant'::user_role
      AND assigned_to = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Назначен'::lead_status, 'Подписан'::lead_status, 'Отмена'::lead_status]))
)
WITH CHECK (
  (SELECT public.get_current_user_role()) = 'admin'::user_role
  OR ((SELECT public.get_current_user_role()) = 'smm'::user_role
      AND created_by = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Открыт'::lead_status, 'Обработан'::lead_status, 'Отмена'::lead_status]))
  OR ((SELECT public.get_current_user_role()) = 'consultant'::user_role
      AND assigned_to = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Назначен'::lead_status, 'Подписан'::lead_status, 'Отмена'::lead_status]))
);

-- ------------------------------------------------------------------------------
-- 2. Подключения: подтверждение администратором
-- ------------------------------------------------------------------------------
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(10) NOT NULL DEFAULT 'confirmed';
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.connections'::regclass AND conname = 'connections_confirmation_status_check'
  ) THEN
    ALTER TABLE public.connections ADD CONSTRAINT connections_confirmation_status_check
      CHECK (confirmation_status IN ('pending', 'confirmed', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_connections_confirmation_pending
  ON public.connections (confirmation_status) WHERE confirmation_status <> 'confirmed';

-- Существующие подключения считаются подтвержденными при создании
UPDATE public.connections
SET confirmed_at = COALESCE(confirmed_at, assigned_at),
    confirmed_by = COALESCE(confirmed_by, assigned_by)
WHERE confirmation_status = 'confirmed' AND (confirmed_at IS NULL OR confirmed_by IS NULL);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_connections_touch_updated_at
BEFORE UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Представление: тот же список колонок (CREATE OR REPLACE допускает только добавление в конец)
CREATE OR REPLACE VIEW public.connections_with_accruals WITH (security_invoker = true) AS
SELECT
  c.connection_id, c.seller_phone, c.seller_name, c.store, c.manager_id, c.assigned_by, c.assigned_at,
  c.status, c.plan_id, c.plan_price, c.connection_fee_percent, c.connection_fee_amount, c.accrual_month,
  c.maintenance_months_limit, c.maintenance_months_accrued, c.client_status, c.maintenance_months_total,
  c.maintenance_month_start, c.maintenance_fee_monthly, c.connection_fee,
  c.connection_id AS id,
  COALESCE((
    SELECT SUM(ep.amount) FROM public.employee_payouts ep
    WHERE ep.connection_id = c.connection_id AND ep.operation_type = 'accrual_connection' AND ep.operation_sign = '+'
  ), 0) AS bonus_connection_accrued,
  COALESCE((
    SELECT SUM(ep.amount) FROM public.employee_payouts ep
    WHERE ep.connection_id = c.connection_id AND ep.operation_type = 'accrual_maintenance' AND ep.operation_sign = '+'
  ), 0) AS bonus_maintenance_accrued,
  COALESCE((
    SELECT SUM(ep.amount) FROM public.employee_payouts ep
    WHERE ep.connection_id = c.connection_id AND ep.operation_sign = '+'
  ), 0) AS total_bonuses_accrued,
  COALESCE((
    SELECT COUNT(DISTINCT ep.settlement_month) FROM public.employee_payouts ep
    WHERE ep.connection_id = c.connection_id AND ep.operation_type = 'accrual_maintenance' AND ep.operation_sign = '+'
  ), 0)::INT AS maintenance_months_accrued_count,
  c.confirmation_status, c.confirmed_by, c.confirmed_at, c.rejection_reason, c.updated_at, c.seller_id
FROM public.connections c;

REVOKE ALL ON public.connections_with_accruals FROM anon;
GRANT SELECT ON public.connections_with_accruals TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. Автоначисление за подключение (035) — только для подтвержденных, в т.ч. при подтверждении
-- ------------------------------------------------------------------------------
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

  -- Начисление только после подтверждения администратором (037)
  IF COALESCE(NEW.confirmation_status, 'confirmed') <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Повторное срабатывание только при смене куратора или статуса
  IF TG_OP = 'UPDATE'
     AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.confirmation_status IS NOT DISTINCT FROM OLD.confirmation_status THEN
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
    v_label, v_label, COALESCE(NEW.confirmed_by, NEW.assigned_by, NEW.manager_id)
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

CREATE OR REPLACE TRIGGER trg_connection_auto_accrual
AFTER INSERT OR UPDATE OF manager_id, status, confirmation_status ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.fn_connection_auto_accrual();

-- ------------------------------------------------------------------------------
-- 4. Процедуры начислений (034) пропускают неподтвержденные подключения
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_connection_bonuses_v2(
  p_mode character varying DEFAULT 'all'::character varying,
  p_settlement_month character varying DEFAULT NULL::character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actual_mode VARCHAR(20);
  v_actual_month VARCHAR(7);
  v_conn RECORD;
  v_conn_created INT := 0;
  v_maint_created INT := 0;
  v_maint_skipped INT := 0;
  v_exists BOOLEAN;
  v_maint_count INT;
  v_limit INT;
  v_effective_conn_fee NUMERIC(12, 2);
  v_effective_maint_fee NUMERIC(12, 2);
  v_rate_val NUMERIC(12, 2);
  v_conn_month VARCHAR(7);
BEGIN
  -- Автоматическая нормализация аргументов при любом порядке вызова
  IF p_mode ~ '^\d{4}-\d{2}$' THEN
    v_actual_month := p_mode;
    v_actual_mode := LOWER(COALESCE(p_settlement_month, 'all'));
  ELSE
    v_actual_mode := LOWER(COALESCE(p_mode, 'all'));
    v_actual_month := COALESCE(p_settlement_month, to_char(CURRENT_DATE, 'YYYY-MM'));
  END IF;

  IF v_actual_mode = 'connection' THEN v_actual_mode := 'connection_only'; END IF;
  IF v_actual_mode = 'maintenance' THEN v_actual_mode := 'maintenance_only'; END IF;

  FOR v_conn IN
    SELECT
      c.*,
      COALESCE(s.is_active, true) AS seller_active,
      s.seller_name AS s_name,
      s.store AS store_name
    FROM public.connections c
    LEFT JOIN public.sellers s ON (s.seller_phone = c.seller_phone OR s.id = c.seller_id)
    WHERE c.manager_id IS NOT NULL
      AND c.confirmation_status = 'confirmed'
      AND (s.is_active IS NULL OR s.is_active = true)
  LOOP
    -- 1. Определение эффективной ставки за подключение:
    v_effective_conn_fee := COALESCE(v_conn.connection_fee, 0);
    IF v_effective_conn_fee <= 0 THEN
      v_effective_conn_fee := COALESCE(v_conn.connection_fee_amount, 0);
    END IF;

    IF v_effective_conn_fee <= 0 AND COALESCE(v_conn.plan_price, 0) > 0 THEN
      v_effective_conn_fee := ROUND((v_conn.plan_price * COALESCE(v_conn.connection_fee_percent, 30)) / 100);
    END IF;

    IF v_effective_conn_fee <= 0 THEN
      SELECT COALESCE(rate_amount, 0) INTO v_rate_val
      FROM public.rates
      WHERE rate_type IN ('fixed', 'connection')
      ORDER BY created_at DESC LIMIT 1;

      IF v_rate_val > 0 THEN
        v_effective_conn_fee := v_rate_val;
      ELSE
        v_effective_conn_fee := 500.00;
      END IF;
    END IF;

    UPDATE public.connections
    SET connection_fee = v_effective_conn_fee,
        connection_fee_amount = COALESCE(NULLIF(connection_fee_amount, 0), v_effective_conn_fee)
    WHERE connection_id = v_conn.connection_id;

    -- 2. Определение эффективной ставки за сопровождение:
    v_effective_maint_fee := COALESCE(v_conn.maintenance_fee_monthly, 0);
    IF v_effective_maint_fee <= 0 AND COALESCE(v_conn.plan_price, 0) > 0 THEN
      v_effective_maint_fee := ROUND(v_conn.plan_price * 0.1);
    END IF;

    IF v_effective_maint_fee <= 0 THEN
      SELECT COALESCE(rate_amount, 0) INTO v_rate_val
      FROM public.rates
      WHERE rate_type IN ('maintenance', 'percentage')
      ORDER BY created_at DESC LIMIT 1;

      IF v_rate_val > 0 THEN
        v_effective_maint_fee := v_rate_val;
      ELSE
        v_effective_maint_fee := 300.00;
      END IF;
    END IF;

    UPDATE public.connections
    SET maintenance_fee_monthly = v_effective_maint_fee
    WHERE connection_id = v_conn.connection_id;

    v_limit := COALESCE(v_conn.maintenance_months_total, v_conn.maintenance_months_limit, 2);

    -- РЕЖИМ 1: НАЧИСЛЕНИЕ ЗА ПОДКЛЮЧЕНИЕ ('all' или 'connection_only')
    IF v_actual_mode IN ('all', 'connection_only') THEN
      v_conn_month := COALESCE(v_conn.accrual_month, v_actual_month);

      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts
        WHERE connection_id = v_conn.connection_id
          AND operation_type = 'accrual_connection'
          AND operation_sign = '+'
      ) INTO v_exists;

      IF NOT v_exists
         AND v_effective_conn_fee > 0
         AND public.payroll_connection_order_error('accrual_connection', v_conn_month, v_conn.seller_phone, v_conn.connection_id) IS NULL THEN
        INSERT INTO public.employee_payouts (
          user_id,
          employee_id,
          connection_id,
          seller_phone,
          seller_id,
          operation_sign,
          operation_type,
          payout_category,
          payment_method,
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
          v_conn.manager_id,
          v_conn.manager_id,
          v_conn.connection_id,
          v_conn.seller_phone,
          v_conn.seller_phone,
          '+',
          'accrual_connection',
          'бонус',
          'система',
          v_effective_conn_fee,
          v_conn_month,
          v_conn_month,
          CURRENT_DATE,
          CURRENT_DATE,
          'completed',
          'Бонус за подключение: ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент'),
          'Бонус за подключение: ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент'),
          v_conn.manager_id
        );
        v_conn_created := v_conn_created + 1;
      END IF;
    END IF;

    -- РЕЖИМ 2: НАЧИСЛЕНИЕ ЗА СОПРОВОЖДЕНИЕ ('all' или 'maintenance_only')
    -- Только со следующего месяца после начисления за подключение
    IF v_actual_mode IN ('all', 'maintenance_only') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts
        WHERE connection_id = v_conn.connection_id
          AND operation_type = 'accrual_maintenance'
          AND operation_sign = '+'
          AND (settlement_month = v_actual_month OR accrual_month = v_actual_month)
      ) INTO v_exists;

      SELECT COUNT(DISTINCT settlement_month) INTO v_maint_count
      FROM public.employee_payouts
      WHERE connection_id = v_conn.connection_id
        AND operation_type = 'accrual_maintenance'
        AND operation_sign = '+';

      IF NOT v_exists
         AND v_effective_maint_fee > 0
         AND v_maint_count < v_limit
         AND (v_conn.maintenance_month_start IS NULL OR v_actual_month >= v_conn.maintenance_month_start)
         AND COALESCE(v_conn.status, v_conn.client_status::text) != 'готов' THEN

        IF public.payroll_connection_order_error('accrual_maintenance', v_actual_month, v_conn.seller_phone, v_conn.connection_id) IS NOT NULL THEN
          v_maint_skipped := v_maint_skipped + 1;
        ELSE
          INSERT INTO public.employee_payouts (
            user_id,
            employee_id,
            connection_id,
            seller_phone,
            seller_id,
            operation_sign,
            operation_type,
            payout_category,
            payment_method,
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
            v_conn.manager_id,
            v_conn.manager_id,
            v_conn.connection_id,
            v_conn.seller_phone,
            v_conn.seller_phone,
            '+',
            'accrual_maintenance',
            'бонус',
            'система',
            v_effective_maint_fee,
            v_actual_month,
            v_actual_month,
            CURRENT_DATE,
            CURRENT_DATE,
            'completed',
            'Бонус за сопровождение (' || v_actual_month || '): ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент'),
            'Бонус за сопровождение (' || v_actual_month || '): ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент'),
            v_conn.manager_id
          );

          IF COALESCE(v_conn.status, v_conn.client_status::text) IN ('подключен', 'новый') THEN
            UPDATE public.connections
            SET status = 'сопровождение',
                client_status = 'сопровождение',
                maintenance_months_accrued = v_maint_count + 1
            WHERE connection_id = v_conn.connection_id;
          END IF;

          IF (v_maint_count + 1) >= v_limit THEN
            UPDATE public.connections
            SET status = 'готов',
                client_status = 'готов',
                maintenance_months_accrued = v_maint_count + 1
            WHERE connection_id = v_conn.connection_id;
          END IF;

          v_maint_created := v_maint_created + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mode', v_actual_mode,
    'settlement_month', v_actual_month,
    'connection_bonuses_created', v_conn_created,
    'maintenance_bonuses_created', v_maint_created,
    'maintenance_skipped_same_month', v_maint_skipped,
    'total_created', v_conn_created + v_maint_created
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.accrue_selected_connections(
  p_connection_ids uuid[],
  p_mode character varying DEFAULT 'all'::character varying,
  p_settlement_month character varying DEFAULT NULL::character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_target_month VARCHAR(7);
  v_conn RECORD;
  v_conn_created INT := 0;
  v_maint_created INT := 0;
  v_maint_skipped INT := 0;
  v_exists BOOLEAN;
  v_maint_count INT;
  v_limit INT;
  v_fee_conn NUMERIC(12,2);
  v_fee_maint NUMERIC(12,2);
  v_plan_price NUMERIC(12,2);
  v_mode VARCHAR(20);
  v_conn_month VARCHAR(7);
BEGIN
  IF p_settlement_month IS NULL OR p_settlement_month = '' THEN
    v_target_month := to_char(CURRENT_DATE, 'YYYY-MM');
  ELSE
    v_target_month := p_settlement_month;
  END IF;

  v_mode := LOWER(COALESCE(p_mode, 'all'));
  IF v_mode = 'connection' THEN v_mode := 'connection_only'; END IF;
  IF v_mode = 'maintenance' THEN v_mode := 'maintenance_only'; END IF;

  FOR v_conn IN
    SELECT
      c.*,
      s.is_active AS seller_is_active,
      s.seller_name AS s_name
    FROM public.connections c
    LEFT JOIN public.sellers s ON s.seller_phone = c.seller_phone
    WHERE (c.connection_id = ANY(p_connection_ids) OR c.id = ANY(p_connection_ids))
      AND c.manager_id IS NOT NULL
      AND c.confirmation_status = 'confirmed'
      AND (s.is_active IS NULL OR s.is_active = true)
  LOOP
    v_plan_price := COALESCE(v_conn.plan_price, 0);
    -- Нулевые ставки (значение по умолчанию) не считаются заданными
    v_fee_conn := COALESCE(
      NULLIF(v_conn.connection_fee_amount, 0),
      NULLIF(v_conn.connection_fee, 0),
      ROUND(v_plan_price * COALESCE(v_conn.connection_fee_percent, 30) / 100)
    );
    v_fee_maint := COALESCE(NULLIF(v_conn.maintenance_fee_monthly, 0), ROUND(v_plan_price * 0.1));
    v_limit := COALESCE(v_conn.maintenance_months_total, v_conn.maintenance_months_limit, 2);

    -- 1. Логика начисления за первичное подключение
    IF v_mode IN ('all', 'connection_only') THEN
      v_conn_month := COALESCE(v_conn.accrual_month, v_target_month);

      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts
        WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
          AND operation_type = 'accrual_connection'
      ) INTO v_exists;

      IF NOT v_exists
         AND v_fee_conn > 0
         AND public.payroll_connection_order_error('accrual_connection', v_conn_month, v_conn.seller_phone, COALESCE(v_conn.connection_id, v_conn.id)) IS NULL THEN
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
          v_conn.manager_id,
          v_conn.manager_id,
          COALESCE(v_conn.connection_id, v_conn.id),
          v_conn.seller_phone,
          '+',
          'accrual_connection',
          'бонус',
          v_fee_conn,
          v_conn_month,
          v_conn_month,
          CURRENT_DATE,
          CURRENT_DATE,
          'completed',
          'Бонус за подключение: ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone),
          'Бонус за подключение: ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone),
          v_conn.manager_id
        );
        v_conn_created := v_conn_created + 1;
      END IF;
    END IF;

    -- 2. Логика начисления за ежемесячное сопровождение (со следующего месяца после подключения)
    IF v_mode IN ('all', 'maintenance_only') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts
        WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
          AND operation_type = 'accrual_maintenance'
          AND (settlement_month = v_target_month OR accrual_month = v_target_month)
      ) INTO v_exists;

      SELECT COUNT(*) INTO v_maint_count
      FROM public.employee_payouts
      WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
        AND operation_type = 'accrual_maintenance';

      IF NOT v_exists
         AND v_fee_maint > 0
         AND v_maint_count < v_limit
         AND (v_conn.maintenance_month_start IS NULL OR v_target_month >= v_conn.maintenance_month_start)
         AND COALESCE(v_conn.status, v_conn.client_status::text) != 'готов' THEN

        IF public.payroll_connection_order_error('accrual_maintenance', v_target_month, v_conn.seller_phone, COALESCE(v_conn.connection_id, v_conn.id)) IS NOT NULL THEN
          v_maint_skipped := v_maint_skipped + 1;
        ELSE
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
            v_conn.manager_id,
            v_conn.manager_id,
            COALESCE(v_conn.connection_id, v_conn.id),
            v_conn.seller_phone,
            '+',
            'accrual_maintenance',
            'бонус',
            v_fee_maint,
            v_target_month,
            v_target_month,
            CURRENT_DATE,
            CURRENT_DATE,
            'completed',
            'Бонус за сопровождение (' || v_target_month || '): ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone),
            'Бонус за сопровождение (' || v_target_month || '): ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone),
            v_conn.manager_id
          );

          -- Обновление счетчика и статуса в connections
          UPDATE public.connections
          SET
            maintenance_months_accrued = v_maint_count + 1,
            client_status = (CASE
              WHEN (v_maint_count + 1) >= v_limit THEN 'готов'
              ELSE 'сопровождение'
            END)::public.client_lifecycle_status,
            status = CASE
              WHEN (v_maint_count + 1) >= v_limit THEN 'готов'
              ELSE 'сопровождение'
            END
          WHERE connection_id = v_conn.connection_id OR id = v_conn.id;

          v_maint_created := v_maint_created + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'settlement_month', v_target_month,
    'connection_bonuses_created', v_conn_created,
    'maintenance_bonuses_created', v_maint_created,
    'maintenance_skipped_same_month', v_maint_skipped,
    'total_created', v_conn_created + v_maint_created
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_maintenance_billing(p_billing_month character varying DEFAULT NULL::character varying)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_conn RECORD;
    v_generated_count INT := 0;
    v_skipped_count INT := 0;
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
          AND c.confirmation_status = 'confirmed'
    LOOP
        IF v_conn.maintenance_month_start IS NOT NULL THEN
            v_start_date := to_date(v_conn.maintenance_month_start || '-01', 'YYYY-MM-DD');
            v_month_diff := (EXTRACT(YEAR FROM v_billing_date) - EXTRACT(YEAR FROM v_start_date)) * 12
                            + (EXTRACT(MONTH FROM v_billing_date) - EXTRACT(MONTH FROM v_start_date));

            IF v_month_diff >= 0 AND v_month_diff < v_conn.maintenance_months_total THEN
                -- Сопровождение только со следующего месяца после начисления за подключение
                IF public.payroll_connection_order_error('accrual_maintenance', v_target_month, v_conn.seller_phone, v_conn.connection_id) IS NOT NULL THEN
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                END IF;

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
        'skipped_before_connection', v_skipped_count,
        'message', 'Сформировано начислений сопровождения: ' || v_generated_count
          || CASE WHEN v_skipped_count > 0
               THEN ' (пропущено ' || v_skipped_count || ': сопровождение начисляется со следующего месяца после подключения)'
               ELSE '' END
    );
END;
$function$;

-- ------------------------------------------------------------------------------
-- 5. Привязка лида к продавцу: одна реализация, статус подтверждения как параметр.
--    Начисление за подключение создает триггер 035 (при confirmed) — без прямых вставок.
--    Старые перегрузки (4 и 5 аргументов) выводятся из набора перегрузок переименованием
--    в link_lead_to_seller_legacy_<N>args и лишаются прав вызова: вместе с новой функцией
--    (у которой есть значения по умолчанию) вызов с 5 аргументами был бы неоднозначным.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS signature, p.pronargs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'link_lead_to_seller' AND p.pronargs <> 6
  LOOP
    EXECUTE 'ALTER FUNCTION ' || r.signature || ' RENAME TO '
      || quote_ident('link_lead_to_seller_legacy_' || r.pronargs || 'args');
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.oid::regprocedure::text || ' FROM PUBLIC, anon, authenticated';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
  p_lead_id UUID,
  p_seller_phone VARCHAR,
  p_user_id UUID DEFAULT NULL,
  p_manager_id UUID DEFAULT NULL,
  p_assigned_by UUID DEFAULT NULL,
  p_confirmation_status TEXT DEFAULT 'confirmed'
)
RETURNS jsonb
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
    v_confirmation TEXT;
BEGIN
    v_assigned_by := COALESCE(p_assigned_by, p_user_id);
    v_confirmation := CASE WHEN p_confirmation_status = 'pending' THEN 'pending' ELSE 'confirmed' END;

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

    SELECT * INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
    END IF;

    SELECT lead_id, client_name INTO v_collision_lead
    FROM public.leads WHERE seller_phone = p_seller_phone LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец +' || p_seller_phone || ' уже привязан к другому лиду («' || v_collision_lead.client_name || '»)');
    END IF;

    v_effective_manager_id := COALESCE(p_manager_id, v_lead.assigned_to, v_assigned_by);

    -- Консультант может взять только продавца без куратора
    IF v_confirmation = 'pending' AND v_seller.manager_id IS NOT NULL AND v_seller.manager_id <> v_effective_manager_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'У продавца уже есть куратор — переназначить может только администратор');
    END IF;

    IF v_seller.plan_id IS NOT NULL THEN
        SELECT price INTO v_plan_price FROM public.plans WHERE plan_id = v_seller.plan_id;
        IF v_plan_price IS NULL OR v_plan_price <= 0 THEN
            v_plan_price := 2500.00;
        END IF;
    END IF;

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

    UPDATE public.leads
    SET seller_phone = p_seller_phone,
        status = 'Подписан',
        linked_at = v_now,
        assigned_to = v_effective_manager_id,
        updated_at = v_now
    WHERE lead_id = p_lead_id;

    UPDATE public.sellers
    SET manager_id = v_effective_manager_id
    WHERE seller_phone = p_seller_phone;

    -- Подключение продавца одно: существующее обновляется, иначе создается
    SELECT connection_id INTO v_connection_id
    FROM public.connections
    WHERE seller_phone = p_seller_phone
    ORDER BY assigned_at DESC
    LIMIT 1;

    IF v_connection_id IS NOT NULL THEN
        UPDATE public.connections
        SET manager_id = v_effective_manager_id,
            assigned_by = COALESCE(v_assigned_by, v_effective_manager_id),
            assigned_at = v_now,
            status = 'подключен',
            client_status = 'подключен',
            plan_id = v_seller.plan_id,
            plan_price = v_plan_price,
            connection_fee_percent = v_connection_percent,
            connection_fee_amount = v_connection_fee_amount,
            connection_fee = v_connection_fee_amount,
            maintenance_fee_monthly = v_maintenance_fee_monthly,
            accrual_month = v_current_month,
            maintenance_month_start = v_maint_start_month,
            confirmation_status = v_confirmation,
            confirmed_by = CASE WHEN v_confirmation = 'confirmed' THEN COALESCE(v_assigned_by, v_effective_manager_id) END,
            confirmed_at = CASE WHEN v_confirmation = 'confirmed' THEN v_now END,
            rejection_reason = NULL
        WHERE connection_id = v_connection_id;
    ELSE
        INSERT INTO public.connections (
            seller_phone, seller_name, store, manager_id, assigned_by, assigned_at, status,
            plan_id, plan_price, connection_fee_percent, connection_fee_amount, connection_fee,
            maintenance_fee_monthly, accrual_month, maintenance_month_start, client_status,
            maintenance_months_total, maintenance_months_limit, maintenance_months_accrued,
            confirmation_status, confirmed_by, confirmed_at
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
            2, 2, 0,
            v_confirmation,
            CASE WHEN v_confirmation = 'confirmed' THEN COALESCE(v_assigned_by, v_effective_manager_id) END,
            CASE WHEN v_confirmation = 'confirmed' THEN v_now END
        ) RETURNING connection_id INTO v_connection_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id,
        'connection_fee_amount', v_connection_fee_amount,
        'confirmation_status', v_confirmation,
        'lead_id', p_lead_id,
        'seller_phone', p_seller_phone
    );
END;
$$;

REVOKE ALL ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID, TEXT) TO service_role;

-- ------------------------------------------------------------------------------
-- 6. Telegram: ожидание подтверждения (администраторам), подтверждение/отклонение (консультанту)
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
  v_manager_name TEXT;
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

  -- Подтверждено (переход в confirmed) — консультанту
  IF TG_OP = 'UPDATE' AND v_confirmation_changed AND NEW.confirmation_status = 'confirmed' THEN
    PERFORM public.telegram_enqueue(NEW.manager_id, 'connections', 'Подключение подтверждено', v_body);
    RETURN NEW;
  END IF;

  -- Новое подтвержденное подключение или передача другому куратору
  PERFORM public.telegram_enqueue(
    NEW.manager_id,
    'connections',
    CASE WHEN TG_OP = 'INSERT' THEN 'Новое подключение' ELSE 'Вам передано подключение' END,
    v_body
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_telegram_on_connection
AFTER INSERT OR UPDATE OF manager_id, confirmation_status ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.trg_telegram_on_connection();

NOTIFY pgrst, 'reload schema';
