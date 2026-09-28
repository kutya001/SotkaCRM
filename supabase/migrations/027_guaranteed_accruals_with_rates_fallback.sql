-- ==============================================================================
-- МИГРАЦИЯ 027: Гарантированные начисления с фоллбеком на ставки (rates)
-- и сквозной проводкой в регистр «Операции по ЗП» (employee_payouts)
-- ==============================================================================

-- 1. Таблица rates для справочных ставок
CREATE TABLE IF NOT EXISTS public.rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_type VARCHAR(50) NOT NULL,
  rate_amount NUMERIC(12, 2) NOT NULL DEFAULT 500.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.rates (rate_type, rate_amount)
SELECT 'connection', 500.00
WHERE NOT EXISTS (SELECT 1 FROM public.rates WHERE rate_type IN ('connection', 'fixed'));

INSERT INTO public.rates (rate_type, rate_amount)
SELECT 'maintenance', 300.00
WHERE NOT EXISTS (SELECT 1 FROM public.rates WHERE rate_type IN ('maintenance', 'percentage'));

GRANT ALL ON public.rates TO authenticated, service_role, anon;

-- 2. Снятие ограничения NOT NULL с payment_method в employee_payouts для начислений
ALTER TABLE public.employee_payouts ALTER COLUMN payment_method DROP NOT NULL;
ALTER TABLE public.employee_payouts ALTER COLUMN payment_method SET DEFAULT 'система';

-- 3. Добавление алиасов id / seller_id в ключевые таблицы для совместимости
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS id UUID;
UPDATE public.connections SET id = connection_id WHERE id IS NULL;
ALTER TABLE public.connections ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS seller_id VARCHAR(50);
UPDATE public.connections SET seller_id = seller_phone WHERE seller_id IS NULL;

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS id VARCHAR(50);
UPDATE public.sellers SET id = seller_phone WHERE id IS NULL;

ALTER TABLE public.employee_payouts ADD COLUMN IF NOT EXISTS id UUID;
UPDATE public.employee_payouts SET id = payout_id WHERE id IS NULL;
ALTER TABLE public.employee_payouts ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.employee_payouts ADD COLUMN IF NOT EXISTS seller_id VARCHAR(50);
UPDATE public.employee_payouts SET seller_id = seller_phone WHERE seller_id IS NULL AND seller_phone IS NOT NULL;

-- 4. Удаление старых неоднозначных перегрузок
DROP FUNCTION IF EXISTS public.accrue_connection_bonuses_v2(VARCHAR, VARCHAR, UUID[]);

-- 5. Пересоздание процедуры accrue_connection_bonuses_v2
CREATE OR REPLACE FUNCTION public.accrue_connection_bonuses_v2(
  p_mode VARCHAR(20) DEFAULT 'all',
  p_settlement_month VARCHAR(7) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actual_mode VARCHAR(20);
  v_actual_month VARCHAR(7);
  v_conn RECORD;
  v_conn_created INT := 0;
  v_maint_created INT := 0;
  v_exists BOOLEAN;
  v_maint_count INT;
  v_limit INT;
  v_effective_conn_fee NUMERIC(12, 2);
  v_effective_maint_fee NUMERIC(12, 2);
  v_rate_val NUMERIC(12, 2);
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

    -- Сохраняем определенную ставку в подключение
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
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts 
        WHERE connection_id = v_conn.connection_id 
          AND operation_type = 'accrual_connection'
          AND operation_sign = '+'
      ) INTO v_exists;

      IF NOT v_exists AND v_effective_conn_fee > 0 THEN
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
          COALESCE(v_conn.accrual_month, v_actual_month),
          COALESCE(v_conn.accrual_month, v_actual_month),
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
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mode', v_actual_mode,
    'settlement_month', v_actual_month,
    'connection_bonuses_created', v_conn_created,
    'maintenance_bonuses_created', v_maint_created,
    'total_created', v_conn_created + v_maint_created
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_connection_bonuses_v2(VARCHAR, VARCHAR) TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
