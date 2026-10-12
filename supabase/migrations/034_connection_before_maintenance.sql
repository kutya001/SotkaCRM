-- ==============================================================================
-- 034_connection_before_maintenance.sql
-- Порядок начислений по продавцу: сначала «за подключение», «за сопровождение» —
-- только со следующего месяца после подключения. В одном месяце по одному продавцу
-- не может быть начислено и за подключение, и за сопровождение.
--
-- 1. payroll_connection_order_error — единая проверка (NULL, если порядок соблюден).
-- 2. Триггер на employee_payouts: любое нарушающее начисление (ручное, из реестра
--    connection_accruals, из RPC) отклоняется с понятной ошибкой.
-- 3. RPC массового начисления не прерываются ошибкой, а пропускают такие подключения:
--    в режиме «Все» сопровождение больше не начисляется в месяце подключения.
-- Миграция идемпотентна.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Проверка порядка начислений
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_connection_order_error(
  p_operation_type TEXT,
  p_month TEXT,
  p_seller_phone TEXT,
  p_connection_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn_month TEXT;
  v_maint_month TEXT;
  v_next_month TEXT;
BEGIN
  IF p_operation_type NOT IN ('accrual_connection', 'accrual_maintenance')
     OR p_month IS NULL
     OR (NULLIF(p_seller_phone, '') IS NULL AND p_connection_id IS NULL) THEN
    RETURN NULL;
  END IF;

  IF p_operation_type = 'accrual_maintenance' THEN
    SELECT MIN(COALESCE(NULLIF(ep.settlement_month, ''), ep.accrual_month))
    INTO v_conn_month
    FROM public.employee_payouts ep
    WHERE ep.operation_type = 'accrual_connection'
      AND (
        (NULLIF(p_seller_phone, '') IS NOT NULL AND ep.seller_phone = p_seller_phone)
        OR (p_connection_id IS NOT NULL AND ep.connection_id = p_connection_id)
      );

    IF v_conn_month IS NULL THEN
      RETURN 'Сопровождение начисляется только после начисления за подключение этого продавца';
    END IF;

    IF p_month <= v_conn_month THEN
      v_next_month := to_char(to_date(v_conn_month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month', 'YYYY-MM');
      RETURN format(
        'За подключение этого продавца начислено в %s: сопровождение можно начислять с %s',
        v_conn_month,
        v_next_month
      );
    END IF;
  ELSE
    SELECT MIN(COALESCE(NULLIF(ep.settlement_month, ''), ep.accrual_month))
    INTO v_maint_month
    FROM public.employee_payouts ep
    WHERE ep.operation_type = 'accrual_maintenance'
      AND (
        (NULLIF(p_seller_phone, '') IS NOT NULL AND ep.seller_phone = p_seller_phone)
        OR (p_connection_id IS NOT NULL AND ep.connection_id = p_connection_id)
      );

    IF v_maint_month IS NOT NULL AND p_month >= v_maint_month THEN
      RETURN format(
        'По этому продавцу уже начислено сопровождение за %s: за подключение можно начислить только в более раннем месяце',
        v_maint_month
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_connection_order_error(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_connection_order_error(TEXT, TEXT, TEXT, UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- 2. Триггер на журнале операций ЗП
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_payouts_enforce_connection_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_error TEXT;
BEGIN
  IF NEW.operation_type NOT IN ('accrual_connection', 'accrual_maintenance') THEN
    RETURN NEW;
  END IF;

  -- При обновлении проверяем только изменение вида, месяца или продавца:
  -- смена статуса/суммы уже существующего начисления не блокируется
  IF TG_OP = 'UPDATE'
     AND NEW.operation_type IS NOT DISTINCT FROM OLD.operation_type
     AND NEW.settlement_month IS NOT DISTINCT FROM OLD.settlement_month
     AND NEW.accrual_month IS NOT DISTINCT FROM OLD.accrual_month
     AND NEW.seller_phone IS NOT DISTINCT FROM OLD.seller_phone
     AND NEW.connection_id IS NOT DISTINCT FROM OLD.connection_id THEN
    RETURN NEW;
  END IF;

  v_error := public.payroll_connection_order_error(
    NEW.operation_type,
    COALESCE(NULLIF(NEW.settlement_month, ''), NEW.accrual_month),
    NEW.seller_phone,
    NEW.connection_id
  );

  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error USING ERRCODE = 'P0001', HINT = 'connection_before_maintenance';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.employee_payouts'::regclass
      AND tgname = 'trg_employee_payouts_connection_order'
  ) THEN
    CREATE TRIGGER trg_employee_payouts_connection_order
    BEFORE INSERT OR UPDATE OF operation_type, settlement_month, accrual_month, seller_phone, connection_id
    ON public.employee_payouts
    FOR EACH ROW
    EXECUTE FUNCTION public.employee_payouts_enforce_connection_order();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Массовое начисление по всем подключениям
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

-- ------------------------------------------------------------------------------
-- 4. Выборочное начисление по списку подключений
-- (заодно исправлены обращения к несуществующим connection_month/updated_at
--  и сравнение varchar с enum client_status, из-за которых RPC падала)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 5. Ежемесячный биллинг сопровождения через реестр connection_accruals
-- ------------------------------------------------------------------------------
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
