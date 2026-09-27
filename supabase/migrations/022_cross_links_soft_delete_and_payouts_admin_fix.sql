-- ============================================================================
-- Миграция 022: Двусторонняя отвязка лида и продавца, метка удаления из источника,
-- массовые действия над подключениями и фикс RLS для выплат
-- ============================================================================

-- 1. Добавление метки удаленных продавцов во внешнем источнике
ALTER TABLE public.sellers 
ADD COLUMN IF NOT EXISTS is_deleted_from_source BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sellers_deleted_from_source ON public.sellers(is_deleted_from_source);

-- Проверяем наличие колонки seller_id в leads (для прямой связки по UUID)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'seller_id'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN seller_id UUID REFERENCES public.sellers(seller_id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_leads_seller_id ON public.leads(seller_id);
  END IF;
END $$;

-- 2. RPC-процедура атомарной отмены привязки unlink_lead_and_seller
CREATE OR REPLACE FUNCTION public.unlink_lead_and_seller(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lead RECORD;
  v_seller RECORD;
  v_seller_phone VARCHAR(50);
  v_seller_id UUID;
BEGIN
  -- Находим лид
  SELECT * INTO v_lead 
  FROM public.leads 
  WHERE lead_id = p_lead_id OR id = p_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Лид с указанным идентификатором не найден: %', p_lead_id USING ERRCODE = 'P0002';
  END IF;

  v_seller_phone := v_lead.seller_phone;
  BEGIN
    v_seller_id := v_lead.seller_id;
  EXCEPTION WHEN OTHERS THEN
    v_seller_id := NULL;
  END;

  IF v_seller_phone IS NULL AND v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Лид не привязан к продавцу' USING ERRCODE = '22000';
  END IF;

  -- 1. Обнуляем привязку в лиде и возвращаем в статус "Назначен"
  UPDATE public.leads 
  SET 
    seller_phone = NULL,
    seller_id = NULL,
    linked_at = NULL,
    status = 'Назначен',
    updated_at = NOW() 
  WHERE lead_id = v_lead.lead_id;

  -- 2. Если у продавца был назначен куратор, обнуляем куратора продавца
  IF v_seller_phone IS NOT NULL THEN
    UPDATE public.sellers 
    SET manager_id = NULL, updated_at = NOW() 
    WHERE seller_phone = v_seller_phone;
  ELSIF v_seller_id IS NOT NULL THEN
    UPDATE public.sellers 
    SET manager_id = NULL, updated_at = NOW() 
    WHERE seller_id = v_seller_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead.lead_id,
    'seller_phone', v_seller_phone,
    'seller_id', v_seller_id,
    'new_status', 'Назначен'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlink_lead_and_seller(UUID) TO authenticated, service_role;

-- 3. RPC-процедура выборочного начисления по массиву подключений accrue_selected_connections
CREATE OR REPLACE FUNCTION public.accrue_selected_connections(
  p_connection_ids UUID[],
  p_mode VARCHAR(20) DEFAULT 'all',            -- 'all', 'connection_only' / 'connection', 'maintenance_only' / 'maintenance'
  p_settlement_month VARCHAR(7) DEFAULT NULL  -- 'YYYY-MM'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    v_fee_conn := COALESCE(v_conn.connection_fee_amount, v_conn.connection_fee, ROUND(v_plan_price * 0.5));
    v_fee_maint := COALESCE(v_conn.maintenance_fee_monthly, ROUND(v_plan_price * 0.1));
    v_limit := COALESCE(v_conn.maintenance_months_total, v_conn.maintenance_months_limit, 2);

    -- 1. Логика начисления за первичное подключение
    IF v_mode IN ('all', 'connection_only') THEN
      SELECT EXISTS(
        SELECT 1 FROM public.employee_payouts 
        WHERE (connection_id = v_conn.connection_id OR connection_id = v_conn.id)
          AND operation_type = 'accrual_connection'
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
          COALESCE(v_conn.connection_id, v_conn.id),
          v_conn.seller_phone,
          '+',
          'accrual_connection',
          'бонус',
          v_fee_conn,
          COALESCE(v_conn.accrual_month, v_conn.connection_month, v_target_month),
          COALESCE(v_conn.accrual_month, v_conn.connection_month, v_target_month),
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
          client_status = CASE 
            WHEN (v_maint_count + 1) >= v_limit THEN 'готов'
            ELSE 'сопровождение'
          END,
          status = CASE 
            WHEN (v_maint_count + 1) >= v_limit THEN 'готов'
            ELSE 'сопровождение'
          END,
          updated_at = NOW() 
        WHERE connection_id = v_conn.connection_id OR id = v_conn.id;

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

GRANT EXECUTE ON FUNCTION public.accrue_selected_connections(UUID[], VARCHAR, VARCHAR) TO authenticated, service_role;

-- 4. Обновление RLS политики для employee_payouts
ALTER TABLE public.employee_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_payouts_select_policy" ON public.employee_payouts;
DROP POLICY IF EXISTS "employee_payouts_read_policy" ON public.employee_payouts;

CREATE POLICY "employee_payouts_select_policy" ON public.employee_payouts
FOR SELECT TO authenticated
USING (
  public.get_current_user_role() IN ('admin', 'supervisor')
  OR
  user_id = public.get_current_user_id()
  OR
  employee_id = public.get_current_user_id()
);
