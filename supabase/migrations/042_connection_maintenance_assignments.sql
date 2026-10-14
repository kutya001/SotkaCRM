-- ==============================================================================
-- 042_connection_maintenance_assignments.sql
-- Разделение «кто подключил» и «кто сопровождает» подключение:
--  - connections.manager_id — сотрудник, подключивший продавца (бонус за подключение);
--  - connection_maintenance_assignments — сотрудник сопровождения по каждому месяцу
--    (1-й месяц, 2-й месяц, ...). Без записи сопровождает подключивший (по умолчанию).
--  - Назначение сопровождения не подтверждается сразу: статус planned → accrued
--    в момент начисления за соответствующий месяц (RPC начислений 034/037).
--  - При смене подключившего неоплаченное начисление за подключение переходит новому.
--  - Telegram: сотруднику сообщается о назначенном сопровождении.
-- Миграция идемпотентна.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Таблица назначений сопровождения по месяцам
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connection_maintenance_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  month_index   INT  NOT NULL CHECK (month_index BETWEEN 1 AND 24),
  user_id       UUID NOT NULL REFERENCES public.users(user_id),
  assigned_by   UUID REFERENCES public.users(user_id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- planned: назначено, ждет начисления; accrued: начислено (подтверждено начислением)
  status        VARCHAR(10) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'accrued')),
  accrued_month VARCHAR(7),
  accrued_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_connection_maintenance_month UNIQUE (connection_id, month_index)
);

CREATE INDEX IF NOT EXISTS idx_conn_maint_assign_user ON public.connection_maintenance_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_conn_maint_assign_connection ON public.connection_maintenance_assignments (connection_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connection_maintenance_assignments'::regclass
      AND tgname = 'trg_conn_maint_assign_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_conn_maint_assign_touch_updated_at
    BEFORE UPDATE ON public.connection_maintenance_assignments
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.connection_maintenance_assignments ENABLE ROW LEVEL SECURITY;

-- Чтение: администратор и учредитель — все; сотрудник — свои назначения и назначения по своим подключениям
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_maintenance_assignments' AND policyname = 'conn_maint_assign_select') THEN
    CREATE POLICY conn_maint_assign_select ON public.connection_maintenance_assignments
      FOR SELECT TO authenticated
      USING (
        public.get_current_user_role() IN ('admin', 'supervisor')
        OR user_id = public.get_current_crm_user_id()
        OR EXISTS (
          SELECT 1 FROM public.connections c
          WHERE c.connection_id = connection_maintenance_assignments.connection_id
            AND c.manager_id = public.get_current_crm_user_id()
        )
      );
  END IF;
END $$;

-- Запись: только администратор (API пишет сервисной ролью после проверки прав модуля)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_maintenance_assignments' AND policyname = 'conn_maint_assign_admin_write') THEN
    CREATE POLICY conn_maint_assign_admin_write ON public.connection_maintenance_assignments
      FOR ALL TO authenticated
      USING (public.get_current_user_role() = 'admin')
      WITH CHECK (public.get_current_user_role() = 'admin');
  END IF;
END $$;

GRANT SELECT ON public.connection_maintenance_assignments TO authenticated;
GRANT ALL ON public.connection_maintenance_assignments TO service_role;

-- ------------------------------------------------------------------------------
-- 2. Сотрудник сопровождения месяца: назначение по месяцу, иначе подключивший
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.connection_maintenance_manager(p_connection_id UUID, p_month_index INT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT a.user_id FROM public.connection_maintenance_assignments a
      WHERE a.connection_id = p_connection_id AND a.month_index = p_month_index),
    (SELECT c.manager_id FROM public.connections c WHERE c.connection_id = p_connection_id)
  );
$$;

REVOKE ALL ON FUNCTION public.connection_maintenance_manager(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connection_maintenance_manager(UUID, INT) TO service_role;

-- Фиксация начисления: назначение месяца получает статус accrued (создается, если его не было)
CREATE OR REPLACE FUNCTION public.connection_maintenance_mark_accrued(
  p_connection_id UUID,
  p_month_index INT,
  p_month VARCHAR,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_connection_id IS NULL OR p_month_index IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.connection_maintenance_assignments (connection_id, month_index, user_id, status, accrued_month, accrued_at)
  VALUES (p_connection_id, p_month_index, p_user_id, 'accrued', p_month, now())
  ON CONFLICT (connection_id, month_index) DO UPDATE
    SET status = 'accrued',
        accrued_month = EXCLUDED.accrued_month,
        accrued_at = now(),
        user_id = EXCLUDED.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.connection_maintenance_mark_accrued(UUID, INT, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connection_maintenance_mark_accrued(UUID, INT, VARCHAR, UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. Смена подключившего: неоплаченное начисление за подключение переходит новому сотруднику
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_connection_manager_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.manager_id IS NULL OR NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.employee_payouts
  SET user_id = NEW.manager_id,
      employee_id = NEW.manager_id
  WHERE connection_id = NEW.connection_id
    AND operation_type = 'accrual_connection'
    AND operation_sign = '+'
    AND COALESCE(status, 'completed') <> 'paid';

  UPDATE public.connection_accruals
  SET employee_id = NEW.manager_id
  WHERE connection_id = NEW.connection_id
    AND accrual_type = 'connection'
    AND is_paid = false;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connections'::regclass AND tgname = 'trg_connection_manager_changed'
  ) THEN
    CREATE TRIGGER trg_connection_manager_changed
    AFTER UPDATE OF manager_id ON public.connections
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_connection_manager_changed();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Telegram: сотруднику о назначенном сопровождении (подтверждается при начислении)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_telegram_on_maintenance_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD;
  v_month TEXT;
  v_assigner TEXT;
BEGIN
  IF NEW.status <> 'planned' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_by IS NOT NULL AND NEW.assigned_by = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT c.seller_name, c.seller_phone, c.store, c.maintenance_month_start, c.maintenance_months_total, c.maintenance_fee_monthly
  INTO v_conn
  FROM public.connections c WHERE c.connection_id = NEW.connection_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_conn.maintenance_month_start ~ '^\d{4}-\d{2}$' THEN
    v_month := to_char(
      to_date(v_conn.maintenance_month_start || '-01', 'YYYY-MM-DD') + ((NEW.month_index - 1) || ' month')::interval,
      'YYYY-MM'
    );
  END IF;
  IF NEW.assigned_by IS NOT NULL THEN
    SELECT full_name INTO v_assigner FROM public.users WHERE user_id = NEW.assigned_by;
  END IF;

  PERFORM public.telegram_enqueue(
    NEW.user_id,
    'connections',
    'Вам назначено сопровождение',
    'Продавец: ' || COALESCE(NULLIF(v_conn.seller_name, ''), '—')
      || E'\nТелефон: +' || v_conn.seller_phone
      || E'\nМагазин: ' || COALESCE(NULLIF(v_conn.store, ''), '—')
      || E'\nМесяц сопровождения: ' || NEW.month_index || ' из ' || COALESCE(v_conn.maintenance_months_total, 2)
      || CASE WHEN v_month IS NOT NULL THEN ' (' || v_month || ')' ELSE '' END
      || E'\nБонус за месяц: ' || public.telegram_format_amount(COALESCE(v_conn.maintenance_fee_monthly, 0)) || ' сом'
      || E'\nПодтверждается при начислении за этот месяц'
      || CASE WHEN v_assigner IS NOT NULL THEN E'\nНазначил: ' || v_assigner ELSE '' END
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connection_maintenance_assignments'::regclass
      AND tgname = 'trg_telegram_on_maintenance_assigned'
  ) THEN
    CREATE TRIGGER trg_telegram_on_maintenance_assigned
    AFTER INSERT OR UPDATE OF user_id ON public.connection_maintenance_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_telegram_on_maintenance_assigned();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. RPC начислений: сопровождение начисляется сотруднику, назначенному на месяц
--    (тела функций — актуальные версии 034/037 с заменой получателя сопровождения)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_connection_bonuses_v2(p_mode character varying DEFAULT 'all'::character varying, p_settlement_month character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_maint_user UUID;
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
          -- Сотрудник, сопровождающий этот месяц (042): назначение по месяцу или подключивший
          v_maint_user := public.connection_maintenance_manager(v_conn.connection_id, v_maint_count + 1);
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
            v_maint_user,
            v_maint_user,
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
            'Бонус за сопровождение ' || (v_maint_count + 1) || ' мес. (' || v_actual_month || '): ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент'),
            'Бонус за сопровождение ' || (v_maint_count + 1) || ' мес. (' || v_actual_month || '): ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент'),
            v_maint_user
          );

          PERFORM public.connection_maintenance_mark_accrued(v_conn.connection_id, v_maint_count + 1, v_actual_month, v_maint_user);

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

CREATE OR REPLACE FUNCTION public.accrue_selected_connections(p_connection_ids uuid[], p_mode character varying DEFAULT 'all'::character varying, p_settlement_month character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_maint_user UUID;
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
          -- Сотрудник, сопровождающий этот месяц (042): назначение по месяцу или подключивший
          v_maint_user := public.connection_maintenance_manager(COALESCE(v_conn.connection_id, v_conn.id), v_maint_count + 1);
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
            v_maint_user,
            v_maint_user,
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
            'Бонус за сопровождение ' || (v_maint_count + 1) || ' мес. (' || v_target_month || '): ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone),
            'Бонус за сопровождение ' || (v_maint_count + 1) || ' мес. (' || v_target_month || '): ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone),
            v_maint_user
          );

          PERFORM public.connection_maintenance_mark_accrued(COALESCE(v_conn.connection_id, v_conn.id), v_maint_count + 1, v_target_month, v_maint_user);

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
    v_maint_user UUID;
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
                -- Сотрудник, сопровождающий этот месяц (042): назначение по месяцу или подключивший
                v_maint_user := public.connection_maintenance_manager(v_conn.connection_id, v_month_diff + 1);

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
                    v_maint_user,
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
                    PERFORM public.connection_maintenance_mark_accrued(v_conn.connection_id, v_month_diff + 1, v_target_month, v_maint_user);

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

NOTIFY pgrst, 'reload schema';
