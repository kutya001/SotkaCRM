-- ==============================================================================
-- МИГРАЦИЯ 021: Реорганизация начислений по подключениям, реальные проводки
-- и поддержка выборочных режимов начислений (v2)
-- ==============================================================================

-- 1. Расширение таблицы employee_payouts необходимыми колонками для связи с подключениями
ALTER TABLE public.employee_payouts 
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.connections(connection_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_phone VARCHAR(20) REFERENCES public.sellers(seller_phone) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS operation_sign VARCHAR(1) DEFAULT '-',
  ADD COLUMN IF NOT EXISTS actual_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'paid';

-- Синхронизация user_id и employee_id при их наличии
UPDATE public.employee_payouts 
SET employee_id = user_id 
WHERE employee_id IS NULL AND user_id IS NOT NULL;

-- 2. Снятие строгого ограничения NOT NULL с payment_method для системных начислений
ALTER TABLE public.employee_payouts 
  ALTER COLUMN payment_method DROP NOT NULL;

-- 3. Обновление CHECK-ограничения типов операций operation_type
ALTER TABLE public.employee_payouts 
  DROP CONSTRAINT IF EXISTS employee_payouts_operation_type_check;
ALTER TABLE public.employee_payouts 
  DROP CONSTRAINT IF EXISTS chk_operation_type;

ALTER TABLE public.employee_payouts 
  ADD CONSTRAINT employee_payouts_operation_type_check 
  CHECK (operation_type IN (
    'payout', 
    'deduction', 
    'advance', 
    'salary_base', 
    'bonus_other', 
    'accrual_connection', 
    'accrual_maintenance'
  ));

-- 4. Гарантия наличия настраиваемого срока сопровождения в connections
ALTER TABLE public.connections 
  ADD COLUMN IF NOT EXISTS maintenance_months_total INT NOT NULL DEFAULT 2;

-- Индексы для мгновенной выборки проводок подключения
CREATE INDEX IF NOT EXISTS idx_employee_payouts_conn_id 
  ON public.employee_payouts(connection_id);

CREATE INDEX IF NOT EXISTS idx_employee_payouts_conn_op 
  ON public.employee_payouts(connection_id, operation_type);

-- 5. Хранимая RPC-функция выборочного начисления accrue_connection_bonuses_v2
CREATE OR REPLACE FUNCTION public.accrue_connection_bonuses_v2(
  p_mode VARCHAR(20) DEFAULT 'all',            -- 'all', 'connection_only', 'maintenance_only'
  p_settlement_month VARCHAR(7) DEFAULT NULL   -- 'YYYY-MM'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_month VARCHAR(7);
  v_mode VARCHAR(20);
  v_conn RECORD;
  v_admin_id UUID;
  v_conn_created INT := 0;
  v_maint_created INT := 0;
  v_exists BOOLEAN;
  v_maint_count INT;
  v_conn_fee NUMERIC(12, 2);
  v_maint_fee NUMERIC(12, 2);
  v_total_months INT;
  v_new_status VARCHAR(50);
BEGIN
  v_target_month := COALESCE(p_settlement_month, to_char(now(), 'YYYY-MM'));
  IF v_target_month !~ '^\d{4}-\d{2}$' THEN
    v_target_month := to_char(now(), 'YYYY-MM');
  END IF;

  v_mode := COALESCE(p_mode, 'all');

  SELECT user_id INTO v_admin_id FROM public.users WHERE role = 'admin' LIMIT 1;

  FOR v_conn IN 
    SELECT 
      c.connection_id,
      c.seller_phone,
      c.manager_id,
      c.status,
      c.assigned_at,
      c.accrual_month,
      COALESCE(c.connection_fee, c.connection_fee_amount, round(c.plan_price * COALESCE(c.connection_fee_percent, 30.0) / 100.0, 2)) AS conn_fee,
      COALESCE(c.maintenance_fee_monthly, round(c.plan_price * 10.0 / 100.0, 2)) AS maint_fee,
      COALESCE(c.maintenance_month_start, to_char((c.assigned_at + INTERVAL '1 month'), 'YYYY-MM')) AS maintenance_month_start,
      COALESCE(c.maintenance_months_total, 2) AS maintenance_months_total,
      COALESCE(c.maintenance_months_accrued, 0) AS maintenance_months_accrued,
      s.is_active AS seller_active 
    FROM public.connections c
    JOIN public.sellers s ON s.seller_phone = c.seller_phone
    WHERE c.manager_id IS NOT NULL AND s.is_active = true
  LOOP
    v_conn_fee := COALESCE(v_conn.conn_fee, 0);
    v_maint_fee := COALESCE(v_conn.maint_fee, 0);
    v_total_months := COALESCE(v_conn.maintenance_months_total, 2);

    -- РЕЖИМ 1: НАЧИСЛЕНИЕ ЗА ПОДКЛЮЧЕНИЕ ('all' или 'connection_only')
    IF v_mode IN ('all', 'connection_only', 'connection') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts 
        WHERE connection_id = v_conn.connection_id 
          AND operation_type = 'accrual_connection'
      ) INTO v_exists;

      IF NOT v_exists THEN
        SELECT EXISTS(
          SELECT 1 FROM public.connection_accruals 
          WHERE connection_id = v_conn.connection_id 
            AND accrual_type = 'connection'
        ) INTO v_exists;
      END IF;

      IF NOT v_exists AND v_conn_fee > 0 THEN
        -- Вставка в реестр проводок employee_payouts
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
          payment_method,
          note,
          comment,
          status,
          created_by
        ) VALUES (
          v_conn.manager_id,
          v_conn.manager_id,
          v_conn.connection_id,
          v_conn.seller_phone,
          '+',
          'accrual_connection',
          'бонус',
          v_conn_fee,
          COALESCE(v_conn.accrual_month, v_target_month),
          COALESCE(v_conn.accrual_month, v_target_month),
          CURRENT_DATE,
          CURRENT_DATE,
          'система',
          'Бонус за подключение контрагента +' || v_conn.seller_phone,
          'Бонус за подключение контрагента +' || v_conn.seller_phone,
          'paid',
          COALESCE(v_admin_id, v_conn.manager_id)
        );

        -- Дублирование в connection_accruals для совместимости
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
          'connection',
          COALESCE(v_conn.accrual_month, v_target_month),
          v_conn_fee,
          false,
          'Бонус за подключение контрагента'
        ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

        v_conn_created := v_conn_created + 1;
      END IF;
    END IF;

    -- РЕЖИМ 2: НАЧИСЛЕНИЕ ЗА СОПРОВОЖДЕНИЕ ('all' или 'maintenance_only')
    IF v_mode IN ('all', 'maintenance_only', 'maintenance') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts 
        WHERE connection_id = v_conn.connection_id 
          AND operation_type = 'accrual_maintenance' 
          AND settlement_month = v_target_month
      ) INTO v_exists;

      IF NOT v_exists THEN
        SELECT EXISTS(
          SELECT 1 FROM public.connection_accruals 
          WHERE connection_id = v_conn.connection_id 
            AND accrual_type = 'maintenance' 
            AND settlement_month = v_target_month
        ) INTO v_exists;
      END IF;

      -- Считаем количество фактически начисленных месяцев сопровождения
      SELECT COUNT(*) INTO v_maint_count
      FROM public.employee_payouts
      WHERE connection_id = v_conn.connection_id 
        AND operation_type = 'accrual_maintenance';

      IF v_maint_count < v_conn.maintenance_months_accrued THEN
        v_maint_count := v_conn.maintenance_months_accrued;
      END IF;

      IF NOT v_exists 
         AND v_maint_fee > 0
         AND v_maint_count < v_total_months
         AND (v_conn.maintenance_month_start IS NULL OR v_target_month >= v_conn.maintenance_month_start)
         AND v_conn.status != 'готов' THEN

        -- Вставка проводки в employee_payouts
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
          payment_method,
          note,
          comment,
          status,
          created_by
        ) VALUES (
          v_conn.manager_id,
          v_conn.manager_id,
          v_conn.connection_id,
          v_conn.seller_phone,
          '+',
          'accrual_maintenance',
          'прочие начисления',
          v_maint_fee,
          v_target_month,
          v_target_month,
          CURRENT_DATE,
          CURRENT_DATE,
          'система',
          'Бонус за сопровождение за месяц ' || v_target_month || ' по +' || v_conn.seller_phone,
          'Бонус за сопровождение за месяц ' || v_target_month || ' по +' || v_conn.seller_phone,
          'paid',
          COALESCE(v_admin_id, v_conn.manager_id)
        );

        -- Дублирование в connection_accruals
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
          v_maint_fee,
          false,
          'Бонус за сопровождение за месяц ' || v_target_month
        ) ON CONFLICT (connection_id, accrual_type, settlement_month) DO NOTHING;

        -- Обновление статуса подключения
        v_new_status := v_conn.status;
        IF (v_maint_count + 1) >= v_total_months THEN
          v_new_status := 'готов';
        ELSE
          v_new_status := 'сопровождение';
        END IF;

        UPDATE public.connections 
        SET status = v_new_status,
            client_status = v_new_status::client_lifecycle_status,
            maintenance_months_accrued = v_maint_count + 1,
            updated_at = NOW()
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
    'total_created', v_conn_created + v_maint_created,
    'message', CASE 
      WHEN v_mode IN ('connection_only', 'connection') THEN 'Начислено бонусов за подключение: ' || v_conn_created
      WHEN v_mode IN ('maintenance_only', 'maintenance') THEN 'Начислено бонусов за сопровождение: ' || v_maint_created
      ELSE 'Начислено бонусов за подключение: ' || v_conn_created || ', за сопровождение: ' || v_maint_created
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_connection_bonuses_v2(VARCHAR, VARCHAR) TO authenticated;

-- Синоним process_unified_connection_accruals для обратной совместимости
CREATE OR REPLACE FUNCTION public.process_unified_connection_accruals(
  p_settlement_month VARCHAR(7) DEFAULT NULL,
  p_accrual_type VARCHAR(20) DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.accrue_connection_bonuses_v2(p_accrual_type, p_settlement_month);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_unified_connection_accruals(VARCHAR, VARCHAR) TO authenticated;
