-- ==============================================================================
-- 043_connection_participants.sql
-- Несколько сотрудников в одном подключении (2–3 консультанта):
--  - connections.manager_id — первый (основной) участник; остальные — connection_participants;
--  - бонус за подключение делится поровну между участниками (доли с копейками: последняя
--    доля добирает остаток, чтобы сумма долей равнялась ставке);
--  - сопровождение месяца: назначенные на месяц сотрудники (connection_maintenance_assignments,
--    теперь несколько строк на месяц), по умолчанию — все участники подключения; бонус
--    сопровождения делится поровну между сопровождающими месяца;
--  - при изменении состава участников неоплаченные начисления за подключение пересчитываются
--    (новым участникам — доля, выбывшим — снимается, остальным — новая доля);
--  - участники подключения могут исключать друг друга (API; права проверяет сервер).
-- Миграция идемпотентна. Часть B (ниже) содержит DROP CONSTRAINT и каскады.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Участники подключения (кроме основного manager_id)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connection_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(user_id),
  added_by      UUID REFERENCES public.users(user_id),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_connection_participant UNIQUE (connection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conn_participants_user ON public.connection_participants (user_id);

ALTER TABLE public.connection_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_participants' AND policyname = 'conn_participants_select') THEN
    CREATE POLICY conn_participants_select ON public.connection_participants
      FOR SELECT TO authenticated
      USING (
        public.get_current_user_role() IN ('admin', 'supervisor')
        OR user_id = public.get_current_crm_user_id()
        OR EXISTS (
          SELECT 1 FROM public.connections c
          WHERE c.connection_id = connection_participants.connection_id
            AND c.manager_id = public.get_current_crm_user_id()
        )
        OR EXISTS (
          SELECT 1 FROM public.connection_participants p2
          WHERE p2.connection_id = connection_participants.connection_id
            AND p2.user_id = public.get_current_crm_user_id()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_participants' AND policyname = 'conn_participants_admin_write') THEN
    CREATE POLICY conn_participants_admin_write ON public.connection_participants
      FOR ALL TO authenticated
      USING (public.get_current_user_role() = 'admin')
      WITH CHECK (public.get_current_user_role() = 'admin');
  END IF;
END $$;

GRANT SELECT ON public.connection_participants TO authenticated;
GRANT ALL ON public.connection_participants TO service_role;

-- ------------------------------------------------------------------------------
-- 2. Несколько строк на месяц сопровождения и несколько начислений на месяц (по сотруднику)
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_maint_month_user
  ON public.connection_maintenance_assignments (connection_id, month_index, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_accrual_employee
  ON public.connection_accruals (connection_id, accrual_type, settlement_month, employee_id);

-- ------------------------------------------------------------------------------
-- 3. Участники, сопровождающие месяца, доли
-- ------------------------------------------------------------------------------

-- Все участники подключения: основной (manager_id) первым, далее по порядку добавления
CREATE OR REPLACE FUNCTION public.connection_participants_of(p_connection_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager UUID;
  v_result UUID[] := '{}';
  v_row RECORD;
BEGIN
  SELECT manager_id INTO v_manager FROM public.connections WHERE connection_id = p_connection_id;
  IF v_manager IS NOT NULL THEN
    v_result := ARRAY[v_manager];
  END IF;
  FOR v_row IN
    SELECT user_id FROM public.connection_participants
    WHERE connection_id = p_connection_id
    ORDER BY added_at, user_id
  LOOP
    IF NOT (v_row.user_id = ANY(v_result)) THEN
      v_result := v_result || v_row.user_id;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.connection_participants_of(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connection_participants_of(UUID) TO service_role;

-- Сопровождающие месяца: назначенные на месяц, иначе все участники подключения
CREATE OR REPLACE FUNCTION public.connection_maintenance_managers(p_connection_id UUID, p_month_index INT)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result UUID[];
BEGIN
  v_result := ARRAY(
    SELECT a.user_id FROM public.connection_maintenance_assignments a
    WHERE a.connection_id = p_connection_id AND a.month_index = p_month_index
    ORDER BY a.assigned_at, a.user_id
  );
  IF COALESCE(cardinality(v_result), 0) = 0 THEN
    v_result := public.connection_participants_of(p_connection_id);
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.connection_maintenance_managers(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connection_maintenance_managers(UUID, INT) TO service_role;

-- Совместимость (042): первый сопровождающий месяца
CREATE OR REPLACE FUNCTION public.connection_maintenance_manager(p_connection_id UUID, p_month_index INT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (public.connection_maintenance_managers(p_connection_id, p_month_index))[1];
$$;

-- Доля i из n от суммы: копейки не теряются (последняя доля добирает остаток)
CREATE OR REPLACE FUNCTION public.connection_split_amount(p_total NUMERIC, p_n INT, p_i INT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_n, 0) <= 1 THEN ROUND(COALESCE(p_total, 0), 2)
    WHEN p_i >= p_n THEN ROUND(COALESCE(p_total, 0), 2) - ROUND(COALESCE(p_total, 0) / p_n, 2) * (p_n - 1)
    ELSE ROUND(COALESCE(p_total, 0) / p_n, 2)
  END;
$$;

-- Фиксация начисления сопровождения: строка (подключение, месяц, сотрудник) получает статус accrued
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
  ON CONFLICT (connection_id, month_index, user_id) DO UPDATE
    SET status = 'accrued',
        accrued_month = EXCLUDED.accrued_month,
        accrued_at = now();
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Начисление за подключение при подтверждении: доли всем участникам
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
  v_users UUID[];
  v_n INT;
  v_i INT;
  v_share NUMERIC(12, 2);
  v_share_label TEXT;
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

  -- Участники подключения (043): доли поровну
  v_users := public.connection_participants_of(NEW.connection_id);
  v_n := COALESCE(cardinality(v_users), 0);
  IF v_n = 0 THEN
    v_users := ARRAY[NEW.manager_id];
    v_n := 1;
  END IF;

  FOR v_i IN 1..v_n LOOP
    v_share := public.connection_split_amount(v_fee, v_n, v_i);
    v_share_label := v_label || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END;

    INSERT INTO public.employee_payouts (
      user_id, employee_id, connection_id, seller_phone, seller_id,
      operation_sign, operation_type, payout_category, payment_method, amount,
      settlement_month, accrual_month, actual_date, payout_date, status,
      note, comment, created_by
    ) VALUES (
      v_users[v_i], v_users[v_i], NEW.connection_id, NEW.seller_phone, NEW.seller_phone,
      '+', 'accrual_connection', 'бонус', 'система', v_share,
      v_month, v_month, CURRENT_DATE, CURRENT_DATE, 'completed',
      v_share_label, v_share_label, COALESCE(NEW.confirmed_by, NEW.assigned_by, NEW.manager_id)
    );

    -- Реестр начислений подключений: триггер синхронизации увидит готовую проводку и не продублирует ее
    INSERT INTO public.connection_accruals (
      connection_id, seller_phone, employee_id, accrual_type, settlement_month, amount, is_paid, notes
    ) VALUES (
      NEW.connection_id, NEW.seller_phone, v_users[v_i], 'connection', v_month, v_share, false, v_share_label
    )
    ON CONFLICT (connection_id, accrual_type, settlement_month, employee_id) DO NOTHING;
  END LOOP;

  -- Фактическая ставка сохраняется в подключении (как делает массовое начисление)
  UPDATE public.connections
  SET connection_fee = v_fee,
      connection_fee_amount = COALESCE(NULLIF(connection_fee_amount, 0), v_fee)
  WHERE connection_id = NEW.connection_id
    AND (COALESCE(connection_fee, 0) <= 0 OR COALESCE(connection_fee_amount, 0) <= 0);

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Telegram: участнику о добавлении в подключение
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
BEGIN
  IF NEW.added_by IS NOT NULL AND NEW.added_by = NEW.user_id THEN
    RETURN NEW;
  END IF;
  SELECT c.seller_name, c.seller_phone, c.store, c.connection_fee, c.connection_fee_amount, c.plan_price, c.connection_fee_percent
  INTO v_conn
  FROM public.connections c WHERE c.connection_id = NEW.connection_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_n := COALESCE(cardinality(public.connection_participants_of(NEW.connection_id)), 1);
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
      || E'\nУчастников: ' || v_n || ' — бонусы за подключение и сопровождение делятся поровну'
      || CASE WHEN v_adder IS NOT NULL THEN E'\nДобавил: ' || v_adder ELSE '' END
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connection_participants'::regclass AND tgname = 'trg_telegram_on_participant_added'
  ) THEN
    CREATE TRIGGER trg_telegram_on_participant_added
    AFTER INSERT ON public.connection_participants
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_telegram_on_participant_added();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 6. RPC начислений: доли участникам / сопровождающим месяца
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_connection_bonuses_v2(p_mode character varying DEFAULT 'all'::character varying, p_settlement_month character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_users UUID[];
  v_n INT;
  v_i INT;
  v_share NUMERIC(12, 2);
  v_label TEXT;
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

    -- РЕЖИМ 1: НАЧИСЛЕНИЕ ЗА ПОДКЛЮЧЕНИЕ — доли участникам
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
        v_users := public.connection_participants_of(v_conn.connection_id);
        v_n := COALESCE(cardinality(v_users), 0);
        IF v_n = 0 THEN v_users := ARRAY[v_conn.manager_id]; v_n := 1; END IF;
        FOR v_i IN 1..v_n LOOP
          v_share := public.connection_split_amount(v_effective_conn_fee, v_n, v_i);
          v_label := 'Бонус за подключение: ' || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент')
            || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END;
          INSERT INTO public.employee_payouts (
            user_id, employee_id, connection_id, seller_phone, seller_id,
            operation_sign, operation_type, payout_category, payment_method, amount,
            settlement_month, accrual_month, actual_date, payout_date, status,
            note, comment, created_by
          ) VALUES (
            v_users[v_i], v_users[v_i], v_conn.connection_id, v_conn.seller_phone, v_conn.seller_phone,
            '+', 'accrual_connection', 'бонус', 'система', v_share,
            v_conn_month, v_conn_month, CURRENT_DATE, CURRENT_DATE, 'completed',
            v_label, v_label, v_conn.manager_id
          );
        END LOOP;
        v_conn_created := v_conn_created + 1;
      END IF;
    END IF;

    -- РЕЖИМ 2: НАЧИСЛЕНИЕ ЗА СОПРОВОЖДЕНИЕ — доли сопровождающим месяца
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
          v_users := public.connection_maintenance_managers(v_conn.connection_id, v_maint_count + 1);
          v_n := COALESCE(cardinality(v_users), 0);
          IF v_n = 0 THEN v_users := ARRAY[v_conn.manager_id]; v_n := 1; END IF;
          FOR v_i IN 1..v_n LOOP
            v_share := public.connection_split_amount(v_effective_maint_fee, v_n, v_i);
            v_label := 'Бонус за сопровождение ' || (v_maint_count + 1) || ' мес. (' || v_actual_month || '): '
              || COALESCE(v_conn.store_name, v_conn.store, v_conn.seller_name, v_conn.s_name, 'контрагент')
              || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END;
            INSERT INTO public.employee_payouts (
              user_id, employee_id, connection_id, seller_phone, seller_id,
              operation_sign, operation_type, payout_category, payment_method, amount,
              settlement_month, accrual_month, actual_date, payout_date, status,
              note, comment, created_by
            ) VALUES (
              v_users[v_i], v_users[v_i], v_conn.connection_id, v_conn.seller_phone, v_conn.seller_phone,
              '+', 'accrual_maintenance', 'бонус', 'система', v_share,
              v_actual_month, v_actual_month, CURRENT_DATE, CURRENT_DATE, 'completed',
              v_label, v_label, v_users[v_i]
            );
            PERFORM public.connection_maintenance_mark_accrued(v_conn.connection_id, v_maint_count + 1, v_actual_month, v_users[v_i]);
          END LOOP;

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
  v_users UUID[];
  v_n INT;
  v_i INT;
  v_share NUMERIC(12, 2);
  v_label TEXT;
  v_cid UUID;
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
    v_cid := COALESCE(v_conn.connection_id, v_conn.id);
    v_plan_price := COALESCE(v_conn.plan_price, 0);
    v_fee_conn := COALESCE(
      NULLIF(v_conn.connection_fee_amount, 0),
      NULLIF(v_conn.connection_fee, 0),
      ROUND(v_plan_price * COALESCE(v_conn.connection_fee_percent, 30) / 100)
    );
    v_fee_maint := COALESCE(NULLIF(v_conn.maintenance_fee_monthly, 0), ROUND(v_plan_price * 0.1));
    v_limit := COALESCE(v_conn.maintenance_months_total, v_conn.maintenance_months_limit, 2);

    -- 1. Начисление за подключение — доли участникам
    IF v_mode IN ('all', 'connection_only') THEN
      v_conn_month := COALESCE(v_conn.accrual_month, v_target_month);

      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts
        WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
          AND operation_type = 'accrual_connection'
      ) INTO v_exists;

      IF NOT v_exists
         AND v_fee_conn > 0
         AND public.payroll_connection_order_error('accrual_connection', v_conn_month, v_conn.seller_phone, v_cid) IS NULL THEN
        v_users := public.connection_participants_of(v_cid);
        v_n := COALESCE(cardinality(v_users), 0);
        IF v_n = 0 THEN v_users := ARRAY[v_conn.manager_id]; v_n := 1; END IF;
        FOR v_i IN 1..v_n LOOP
          v_share := public.connection_split_amount(v_fee_conn, v_n, v_i);
          v_label := 'Бонус за подключение: ' || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone)
            || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END;
          INSERT INTO public.employee_payouts (
            user_id, employee_id, connection_id, seller_phone,
            operation_sign, operation_type, payout_category, amount,
            settlement_month, accrual_month, actual_date, payout_date, status,
            note, comment, created_by
          ) VALUES (
            v_users[v_i], v_users[v_i], v_cid, v_conn.seller_phone,
            '+', 'accrual_connection', 'бонус', v_share,
            v_conn_month, v_conn_month, CURRENT_DATE, CURRENT_DATE, 'completed',
            v_label, v_label, v_conn.manager_id
          );
        END LOOP;
        v_conn_created := v_conn_created + 1;
      END IF;
    END IF;

    -- 2. Сопровождение (со следующего месяца после подключения) — доли сопровождающим месяца
    IF v_mode IN ('all', 'maintenance_only') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts
        WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
          AND operation_type = 'accrual_maintenance'
          AND (settlement_month = v_target_month OR accrual_month = v_target_month)
      ) INTO v_exists;

      SELECT COUNT(DISTINCT settlement_month) INTO v_maint_count
      FROM public.employee_payouts
      WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
        AND operation_type = 'accrual_maintenance';

      IF NOT v_exists
         AND v_fee_maint > 0
         AND v_maint_count < v_limit
         AND (v_conn.maintenance_month_start IS NULL OR v_target_month >= v_conn.maintenance_month_start)
         AND COALESCE(v_conn.status, v_conn.client_status::text) != 'готов' THEN

        IF public.payroll_connection_order_error('accrual_maintenance', v_target_month, v_conn.seller_phone, v_cid) IS NOT NULL THEN
          v_maint_skipped := v_maint_skipped + 1;
        ELSE
          v_users := public.connection_maintenance_managers(v_cid, v_maint_count + 1);
          v_n := COALESCE(cardinality(v_users), 0);
          IF v_n = 0 THEN v_users := ARRAY[v_conn.manager_id]; v_n := 1; END IF;
          FOR v_i IN 1..v_n LOOP
            v_share := public.connection_split_amount(v_fee_maint, v_n, v_i);
            v_label := 'Бонус за сопровождение ' || (v_maint_count + 1) || ' мес. (' || v_target_month || '): '
              || COALESCE(v_conn.seller_name, v_conn.s_name, v_conn.seller_phone)
              || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END;
            INSERT INTO public.employee_payouts (
              user_id, employee_id, connection_id, seller_phone,
              operation_sign, operation_type, payout_category, amount,
              settlement_month, accrual_month, actual_date, payout_date, status,
              note, comment, created_by
            ) VALUES (
              v_users[v_i], v_users[v_i], v_cid, v_conn.seller_phone,
              '+', 'accrual_maintenance', 'бонус', v_share,
              v_target_month, v_target_month, CURRENT_DATE, CURRENT_DATE, 'completed',
              v_label, v_label, v_users[v_i]
            );
            PERFORM public.connection_maintenance_mark_accrued(v_cid, v_maint_count + 1, v_target_month, v_users[v_i]);
          END LOOP;

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
    v_users UUID[];
    v_n INT;
    v_i INT;
    v_share NUMERIC(12, 2);
    v_inserted INT;
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
                IF public.payroll_connection_order_error('accrual_maintenance', v_target_month, v_conn.seller_phone, v_conn.connection_id) IS NOT NULL THEN
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                END IF;

                -- Сопровождение уже начислено за этот месяц — пропуск
                IF EXISTS (
                    SELECT 1 FROM public.connection_accruals
                    WHERE connection_id = v_conn.connection_id AND accrual_type = 'maintenance' AND settlement_month = v_target_month
                ) THEN
                    CONTINUE;
                END IF;

                v_users := public.connection_maintenance_managers(v_conn.connection_id, v_month_diff + 1);
                v_n := COALESCE(cardinality(v_users), 0);
                IF v_n = 0 THEN v_users := ARRAY[v_conn.manager_id]; v_n := 1; END IF;
                v_inserted := 0;

                FOR v_i IN 1..v_n LOOP
                    v_share := public.connection_split_amount(v_conn.maintenance_fee_monthly, v_n, v_i);
                    v_accrual_id := NULL;
                    INSERT INTO public.connection_accruals (
                        connection_id, seller_phone, employee_id, accrual_type, settlement_month, amount, is_paid, notes
                    ) VALUES (
                        v_conn.connection_id, v_conn.seller_phone, v_users[v_i], 'maintenance', v_target_month,
                        v_share, false,
                        'Сопровождение (' || (v_month_diff + 1) || ' из ' || v_conn.maintenance_months_total || ' мес.)'
                          || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END
                    )
                    ON CONFLICT (connection_id, accrual_type, settlement_month, employee_id) DO NOTHING
                    RETURNING id INTO v_accrual_id;
                    IF v_accrual_id IS NOT NULL THEN
                        v_inserted := v_inserted + 1;
                        PERFORM public.connection_maintenance_mark_accrued(v_conn.connection_id, v_month_diff + 1, v_target_month, v_users[v_i]);
                    END IF;
                END LOOP;

                IF v_inserted > 0 THEN
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

-- ==============================================================================
-- ЧАСТЬ B: ограничения уникальности по сотруднику, синхронизация реестра, пересчет долей
-- ==============================================================================

-- 7. Старые ограничения «одна строка на месяц» снимаются (новые индексы по сотруднику — выше)
ALTER TABLE public.connection_accruals DROP CONSTRAINT IF EXISTS uq_conn_accrual;
ALTER TABLE public.connection_maintenance_assignments DROP CONSTRAINT IF EXISTS uq_connection_maintenance_month;

-- 8. Синхронизация connection_accruals → employee_payouts учитывает сотрудника (несколько долей на месяц)
CREATE OR REPLACE FUNCTION public.fn_sync_conn_accrual_to_employee_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_op_type VARCHAR(50);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_op_type := CASE WHEN OLD.accrual_type = 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END;

        DELETE FROM public.employee_payouts
        WHERE connection_id = OLD.connection_id
          AND operation_type = v_op_type
          AND (settlement_month = OLD.settlement_month OR accrual_month = OLD.settlement_month)
          AND (employee_id = OLD.employee_id OR user_id = OLD.employee_id);

        RETURN OLD;
    END IF;

    v_op_type := CASE WHEN NEW.accrual_type = 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END;

    IF TG_OP = 'UPDATE' THEN
        UPDATE public.employee_payouts
        SET amount = NEW.amount,
            settlement_month = NEW.settlement_month,
            accrual_month = NEW.settlement_month,
            status = CASE WHEN NEW.is_paid THEN 'paid' ELSE 'completed' END,
            note = COALESCE(NEW.notes, note),
            comment = COALESCE(NEW.notes, comment),
            actual_date = COALESCE(NEW.paid_at::date, actual_date, CURRENT_DATE),
            user_id = NEW.employee_id,
            employee_id = NEW.employee_id
        WHERE connection_id = NEW.connection_id
          AND operation_type = v_op_type
          AND (settlement_month = OLD.settlement_month OR accrual_month = OLD.settlement_month)
          AND (employee_id = OLD.employee_id OR user_id = OLD.employee_id);

        IF NOT FOUND THEN
            INSERT INTO public.employee_payouts (
                user_id, employee_id, connection_id, seller_phone, operation_sign, operation_type, payout_category,
                amount, settlement_month, accrual_month, actual_date, payout_date, status, note, comment, created_by
            ) VALUES (
                NEW.employee_id, NEW.employee_id, NEW.connection_id, NEW.seller_phone, '+', v_op_type, 'бонус',
                NEW.amount, NEW.settlement_month, NEW.settlement_month,
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                CASE WHEN NEW.is_paid THEN 'paid' ELSE 'completed' END,
                NEW.notes, NEW.notes, NEW.employee_id
            );
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.employee_payouts
            WHERE connection_id = NEW.connection_id
              AND operation_type = v_op_type
              AND (settlement_month = NEW.settlement_month OR accrual_month = NEW.settlement_month)
              AND (employee_id = NEW.employee_id OR user_id = NEW.employee_id)
        ) THEN
            INSERT INTO public.employee_payouts (
                user_id, employee_id, connection_id, seller_phone, operation_sign, operation_type, payout_category,
                amount, settlement_month, accrual_month, actual_date, payout_date, status, note, comment, created_by
            ) VALUES (
                NEW.employee_id, NEW.employee_id, NEW.connection_id, NEW.seller_phone, '+', v_op_type, 'бонус',
                NEW.amount, NEW.settlement_month, NEW.settlement_month,
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                COALESCE(NEW.paid_at::date, NEW.created_at::date, CURRENT_DATE),
                CASE WHEN NEW.is_paid THEN 'paid' ELSE 'completed' END,
                NEW.notes, NEW.notes, NEW.employee_id
            );
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$function$;

-- 9. Пересчет долей начисления за подключение по текущему составу участников
--    (только если начисление уже есть; оплаченные доли не трогаются)
CREATE OR REPLACE FUNCTION public.connection_resync_connection_accruals(p_connection_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD;
  v_users UUID[];
  v_n INT;
  v_i INT;
  v_share NUMERIC(12, 2);
  v_total NUMERIC(12, 2);
  v_month VARCHAR(7);
  v_label TEXT;
  v_seller_store TEXT;
  v_status TEXT;
BEGIN
  SELECT * INTO v_conn FROM public.connections WHERE connection_id = p_connection_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Начисления за подключение еще нет — делить нечего (появится при подтверждении)
  SELECT MIN(COALESCE(NULLIF(settlement_month, ''), accrual_month)) INTO v_month
  FROM public.employee_payouts
  WHERE connection_id = p_connection_id AND operation_type = 'accrual_connection' AND operation_sign = '+';
  IF v_month IS NULL THEN RETURN; END IF;

  v_users := public.connection_participants_of(p_connection_id);
  v_n := COALESCE(cardinality(v_users), 0);
  IF v_n = 0 THEN RETURN; END IF;

  v_total := COALESCE(NULLIF(v_conn.connection_fee, 0), NULLIF(v_conn.connection_fee_amount, 0), 0);
  IF v_total <= 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.employee_payouts
    WHERE connection_id = p_connection_id AND operation_type = 'accrual_connection' AND operation_sign = '+';
  END IF;
  IF v_total <= 0 THEN RETURN; END IF;

  SELECT s.store INTO v_seller_store FROM public.sellers s WHERE s.seller_phone = v_conn.seller_phone;

  -- Выбывшие участники: неоплаченные доли снимаются (реестр → журнал ЗП по триггеру, затем остатки)
  DELETE FROM public.connection_accruals
  WHERE connection_id = p_connection_id
    AND accrual_type = 'connection'
    AND is_paid = false
    AND NOT (employee_id = ANY(v_users));
  DELETE FROM public.employee_payouts
  WHERE connection_id = p_connection_id
    AND operation_type = 'accrual_connection'
    AND operation_sign = '+'
    AND COALESCE(status, 'completed') <> 'paid'
    AND NOT (COALESCE(employee_id, user_id) = ANY(v_users));

  FOR v_i IN 1..v_n LOOP
    v_share := public.connection_split_amount(v_total, v_n, v_i);
    v_label := 'Бонус за подключение: '
      || COALESCE(NULLIF(v_seller_store, ''), NULLIF(v_conn.store, ''), NULLIF(v_conn.seller_name, ''), 'контрагент')
      || CASE WHEN v_n > 1 THEN ' (доля ' || v_i || '/' || v_n || ')' ELSE '' END;

    SELECT COALESCE(status, 'completed') INTO v_status
    FROM public.employee_payouts
    WHERE connection_id = p_connection_id
      AND operation_type = 'accrual_connection'
      AND operation_sign = '+'
      AND COALESCE(employee_id, user_id) = v_users[v_i]
    ORDER BY created_at LIMIT 1;

    IF v_status IS NULL THEN
      INSERT INTO public.employee_payouts (
        user_id, employee_id, connection_id, seller_phone, seller_id,
        operation_sign, operation_type, payout_category, payment_method, amount,
        settlement_month, accrual_month, actual_date, payout_date, status,
        note, comment, created_by
      ) VALUES (
        v_users[v_i], v_users[v_i], p_connection_id, v_conn.seller_phone, v_conn.seller_phone,
        '+', 'accrual_connection', 'бонус', 'система', v_share,
        v_month, v_month, CURRENT_DATE, CURRENT_DATE, 'completed',
        v_label, v_label, COALESCE(v_conn.confirmed_by, v_conn.assigned_by, v_conn.manager_id)
      );
      INSERT INTO public.connection_accruals (
        connection_id, seller_phone, employee_id, accrual_type, settlement_month, amount, is_paid, notes
      ) VALUES (
        p_connection_id, v_conn.seller_phone, v_users[v_i], 'connection', v_month, v_share, false, v_label
      )
      ON CONFLICT (connection_id, accrual_type, settlement_month, employee_id) DO UPDATE
        SET amount = EXCLUDED.amount, notes = EXCLUDED.notes;
    ELSIF v_status <> 'paid' THEN
      UPDATE public.employee_payouts
      SET amount = v_share, note = v_label, comment = v_label
      WHERE connection_id = p_connection_id
        AND operation_type = 'accrual_connection'
        AND operation_sign = '+'
        AND COALESCE(employee_id, user_id) = v_users[v_i]
        AND COALESCE(status, 'completed') <> 'paid';
      UPDATE public.connection_accruals
      SET amount = v_share, notes = v_label
      WHERE connection_id = p_connection_id
        AND accrual_type = 'connection'
        AND employee_id = v_users[v_i]
        AND is_paid = false;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.connection_resync_connection_accruals(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connection_resync_connection_accruals(UUID) TO service_role;

-- 10. Смена основного участника (042) и изменение состава участников → пересчет долей
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
  PERFORM public.connection_resync_connection_accruals(NEW.connection_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_connection_participants_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.connection_resync_connection_accruals(COALESCE(NEW.connection_id, OLD.connection_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.connection_participants'::regclass AND tgname = 'trg_connection_participants_changed'
  ) THEN
    CREATE TRIGGER trg_connection_participants_changed
    AFTER INSERT OR DELETE ON public.connection_participants
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_connection_participants_changed();
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
