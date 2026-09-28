-- ==============================================================================
-- МИГРАЦИЯ 026: Строгое нулевое отображение бонусов до момента проводки и сквозной регистр ЗП
-- ==============================================================================

-- 1. Добавление недостающих колонок в public.employee_payouts
ALTER TABLE public.employee_payouts
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.connections(connection_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS operation_sign VARCHAR(1) DEFAULT '+',
  ADD COLUMN IF NOT EXISTS actual_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS settlement_month VARCHAR(7);

-- 2. Снятие и обновление ограничений
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS employee_payouts_operation_type_check;
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS employee_payouts_operation_sign_check;

ALTER TABLE public.employee_payouts 
  ADD CONSTRAINT employee_payouts_operation_sign_check 
  CHECK (operation_sign IN ('+', '-'));

ALTER TABLE public.employee_payouts
  ADD CONSTRAINT employee_payouts_operation_type_check
  CHECK (operation_type IN (
    'payout', 
    'deduction', 
    'accrual_connection', 
    'accrual_maintenance', 
    'salary_base', 
    'bonus_other', 
    'advance', 
    'fine'
  ));

-- 3. Индексы
CREATE INDEX IF NOT EXISTS idx_employee_payouts_conn_type ON public.employee_payouts(connection_id, operation_type);
CREATE INDEX IF NOT EXISTS idx_employee_payouts_sign ON public.employee_payouts(operation_sign);
CREATE INDEX IF NOT EXISTS idx_employee_payouts_settlement ON public.employee_payouts(settlement_month);

-- 4. Представление connections_with_accruals
CREATE OR REPLACE VIEW public.connections_with_accruals AS
SELECT 
  c.*,
  c.connection_id AS id,
  -- Фактически начисленный бонус за подключение (строго 0, если проводки еще не было)
  COALESCE((
    SELECT SUM(ep.amount) 
    FROM public.employee_payouts ep 
    WHERE ep.connection_id = c.connection_id 
      AND ep.operation_type = 'accrual_connection' 
      AND ep.operation_sign = '+'
  ), 0) AS bonus_connection_accrued,

  -- Фактически начисленные бонусы за сопровождение (строго 0, если начислений не было)
  COALESCE((
    SELECT SUM(ep.amount) 
    FROM public.employee_payouts ep 
    WHERE ep.connection_id = c.connection_id 
      AND ep.operation_type = 'accrual_maintenance' 
      AND ep.operation_sign = '+'
  ), 0) AS bonus_maintenance_accrued,

  -- Суммарный объем фактических начислений по данному подключению
  COALESCE((
    SELECT SUM(ep.amount) 
    FROM public.employee_payouts ep 
    WHERE ep.connection_id = c.connection_id 
      AND ep.operation_sign = '+'
  ), 0) AS total_bonuses_accrued,

  -- Количество фактически начисленных месяцев сопровождения
  COALESCE((
    SELECT COUNT(DISTINCT ep.settlement_month) 
    FROM public.employee_payouts ep 
    WHERE ep.connection_id = c.connection_id 
      AND ep.operation_type = 'accrual_maintenance'
      AND ep.operation_sign = '+'
  ), 0)::INT AS maintenance_months_accrued_count
FROM public.connections c;

GRANT SELECT ON public.connections_with_accruals TO authenticated, service_role, anon;

-- 5. Хранимая процедура accrue_connection_bonuses_v2
CREATE OR REPLACE FUNCTION public.accrue_connection_bonuses_v2(
  p_settlement_month VARCHAR DEFAULT NULL,
  p_accrual_type VARCHAR DEFAULT 'all',
  p_connection_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_month VARCHAR(7);
  v_conn RECORD;
  v_conn_created INT := 0;
  v_maint_created INT := 0;
  v_exists BOOLEAN;
  v_maint_count INT;
  v_limit INT;
  v_fee_conn NUMERIC(12,2);
  v_fee_maint NUMERIC(12,2);
  v_plan_price NUMERIC(12,2);
  v_mode VARCHAR(20);
BEGIN
  IF p_settlement_month IS NULL OR p_settlement_month = '' THEN
    v_target_month := to_char(CURRENT_DATE, 'YYYY-MM');
  ELSE
    v_target_month := p_settlement_month;
  END IF;

  v_mode := LOWER(COALESCE(p_accrual_type, 'all'));
  IF v_mode = 'connection' THEN v_mode := 'connection_only'; END IF;
  IF v_mode = 'maintenance' THEN v_mode := 'maintenance_only'; END IF;

  FOR v_conn IN 
    SELECT 
      c.*,
      s.is_active AS seller_is_active,
      s.seller_name AS s_name
    FROM public.connections c
    LEFT JOIN public.sellers s ON s.seller_phone = c.seller_phone
    WHERE (p_connection_ids IS NULL OR c.connection_id = ANY(p_connection_ids))
      AND c.manager_id IS NOT NULL 
      AND (s.is_active IS NULL OR s.is_active = true)
  LOOP
    v_plan_price := COALESCE(v_conn.plan_price, 0);
    v_fee_conn := COALESCE(v_conn.connection_fee_amount, v_conn.connection_fee, ROUND(v_plan_price * 0.5));
    v_fee_maint := COALESCE(v_conn.maintenance_fee_monthly, ROUND(v_plan_price * 0.1));
    v_limit := COALESCE(v_conn.maintenance_months_total, v_conn.maintenance_months_limit, 2);

    -- 1. Логика начисления за первичное подключение
    IF v_mode IN ('all', 'connection_only') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts 
        WHERE connection_id = v_conn.connection_id
          AND operation_type = 'accrual_connection'
          AND operation_sign = '+'
      ) INTO v_exists;

      IF NOT v_exists AND v_fee_conn > 0 THEN
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
          v_conn.connection_id,
          v_conn.seller_phone,
          '+',
          'accrual_connection',
          'бонус',
          v_fee_conn,
          COALESCE(v_conn.accrual_month, v_target_month),
          COALESCE(v_conn.accrual_month, v_target_month),
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

    -- 2. Логика начисления за ежемесячное сопровождение
    IF v_mode IN ('all', 'maintenance_only') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts 
        WHERE connection_id = v_conn.connection_id
          AND operation_type = 'accrual_maintenance' 
          AND operation_sign = '+'
          AND (settlement_month = v_target_month OR accrual_month = v_target_month)
      ) INTO v_exists;

      SELECT COUNT(DISTINCT settlement_month) INTO v_maint_count
      FROM public.employee_payouts
      WHERE connection_id = v_conn.connection_id
        AND operation_type = 'accrual_maintenance'
        AND operation_sign = '+';

      IF NOT v_exists 
         AND v_fee_maint > 0
         AND v_maint_count < v_limit
         AND (v_conn.maintenance_month_start IS NULL OR v_target_month >= v_conn.maintenance_month_start)
         AND COALESCE(v_conn.status, v_conn.client_status) != 'готов' THEN

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
          v_conn.connection_id,
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
          client_status = CASE 
            WHEN (v_maint_count + 1) >= v_limit THEN 'готов'
            ELSE 'сопровождение'
          END,
          status = CASE 
            WHEN (v_maint_count + 1) >= v_limit THEN 'готов'
            ELSE 'сопровождение'
          END
        WHERE connection_id = v_conn.connection_id;

        v_maint_created := v_maint_created + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'settlement_month', v_target_month,
    'connection_bonuses_created', v_conn_created,
    'maintenance_bonuses_created', v_maint_created,
    'total_created', v_conn_created + v_maint_created
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_connection_bonuses_v2(VARCHAR, VARCHAR, UUID[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
