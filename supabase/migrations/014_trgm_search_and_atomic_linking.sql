-- ==============================================================================
-- 014_trgm_search_and_atomic_linking.sql
-- Глубокая оптимизация производительности SotkaCRM:
-- 1. Расширение pg_trgm и GIN-триграммные индексы для ILIKE-поиска
-- 2. Атомарная RPC-процедура связывания link_lead_to_seller с блокировкой FOR UPDATE
-- 3. SQL-агрегаты get_dashboard_kpi и calculate_payout_accruals
-- ==============================================================================

-- 1. Активация расширения pg_trgm для быстрого поиска подстрок
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. GIN-триграммные индексы для таблицы leads
CREATE INDEX IF NOT EXISTS idx_leads_client_name_trgm 
  ON public.leads USING gin (client_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm 
  ON public.leads USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_comment_trgm 
  ON public.leads USING gin (comment gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_composite_search_trgm 
  ON public.leads USING gin ((client_name || ' ' || COALESCE(phone, '') || ' ' || COALESCE(comment, '')) gin_trgm_ops);

-- 3. GIN-триграммные индексы для таблицы sellers
CREATE INDEX IF NOT EXISTS idx_sellers_seller_name_trgm 
  ON public.sellers USING gin (seller_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sellers_seller_phone_trgm 
  ON public.sellers USING gin (seller_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sellers_store_trgm 
  ON public.sellers USING gin (store gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sellers_composite_search_trgm 
  ON public.sellers USING gin ((seller_name || ' ' || COALESCE(seller_phone, '') || ' ' || COALESCE(store, '')) gin_trgm_ops);

-- 4. Атомарная RPC-процедура связывания лида с продавцом и создания начисления
-- Удаляем старые перегруженные варианты для исключения неоднозначности вызова
DROP FUNCTION IF EXISTS public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID);
DROP FUNCTION IF EXISTS public.link_lead_to_seller(UUID, VARCHAR, UUID);

CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
    p_lead_id UUID,
    p_seller_phone VARCHAR,
    p_user_id UUID DEFAULT NULL,
    p_manager_id UUID DEFAULT NULL,
    p_assigned_by UUID DEFAULT NULL
)
RETURNS JSONB
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
    v_connection_fee_amount NUMERIC(12,2);
    v_connection_id UUID;
    v_current_month VARCHAR(7);
    v_now TIMESTAMPTZ := now();
    v_assigned_by UUID;
    v_effective_manager_id UUID;
BEGIN
    v_assigned_by := COALESCE(p_assigned_by, p_user_id);

    -- 1. Блокируем и проверяем лид
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

    -- 2. Блокируем и проверяем продавца на коллизию
    SELECT * INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
    END IF;

    SELECT lead_id, client_name INTO v_collision_lead 
    FROM public.leads 
    WHERE seller_phone = p_seller_phone 
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец +' || p_seller_phone || ' уже привязан к другому лиду («' || v_collision_lead.client_name || '»)');
    END IF;

    -- 3. Определяем эффективного менеджера / консультанта
    v_effective_manager_id := COALESCE(p_manager_id, v_lead.assigned_to, v_assigned_by);

    -- 4. Получаем стоимость тарифа продавца
    IF v_seller.plan_id IS NOT NULL THEN
        SELECT price INTO v_plan_price FROM public.plans WHERE plan_id = v_seller.plan_id;
        IF v_plan_price IS NULL OR v_plan_price <= 0 THEN 
            v_plan_price := 2500.00; 
        END IF;
    END IF;

    -- 5. Получаем персональную ставку комиссии консультанта
    IF v_effective_manager_id IS NOT NULL THEN
        SELECT connection_percent INTO v_connection_percent
        FROM public.employee_rates
        WHERE user_id = v_effective_manager_id
        ORDER BY effective_from DESC
        LIMIT 1;
    END IF;

    IF v_connection_percent IS NULL THEN
        v_connection_percent := 30.00;
    END IF;

    v_connection_fee_amount := round((v_plan_price * v_connection_percent / 100.0), 2);
    v_current_month := to_char(v_now, 'YYYY-MM');

    -- 6. Обновляем лид
    UPDATE public.leads
    SET seller_phone = p_seller_phone,
        status = 'Подписан',
        linked_at = v_now,
        assigned_to = v_effective_manager_id,
        updated_at = v_now
    WHERE lead_id = p_lead_id;

    -- 7. Обновляем продавца: привязываем куратора
    UPDATE public.sellers
    SET manager_id = v_effective_manager_id
    WHERE seller_phone = p_seller_phone;

    -- 8. Создаем запись в connections
    INSERT INTO public.connections (
        seller_phone,
        seller_name,
        store,
        manager_id,
        assigned_by,
        assigned_at,
        status,
        plan_id,
        plan_price,
        connection_fee_percent,
        connection_fee_amount,
        accrual_month,
        client_status,
        maintenance_months_limit,
        maintenance_months_accrued
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
        v_current_month,
        'новый',
        3,
        0
    ) RETURNING connection_id INTO v_connection_id;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id,
        'connection_fee_amount', v_connection_fee_amount,
        'lead_id', p_lead_id,
        'seller_phone', p_seller_phone
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID) TO authenticated;

-- 5. SQL-агрегат для мгновенного сбора KPI дашборда
CREATE OR REPLACE FUNCTION public.get_dashboard_kpi(
    p_user_id UUID DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_month TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_leads INT := 0;
    v_open_leads INT := 0;
    v_signed_leads INT := 0;
    v_cancelled_leads INT := 0;
    v_active_sellers INT := 0;
    v_total_balance NUMERIC(12,2) := 0;
    v_total_connections INT := 0;
    v_month_payouts NUMERIC(12,2) := 0;
    v_month TEXT := COALESCE(p_month, to_char(now(), 'YYYY-MM'));
BEGIN
    -- Фильтрация воронки лидов в зависимости от роли сотрудника
    IF p_role = 'consultant' AND p_user_id IS NOT NULL THEN
        SELECT 
            count(*),
            count(*) FILTER (WHERE status = 'Открыт'),
            count(*) FILTER (WHERE status = 'Подписан'),
            count(*) FILTER (WHERE status = 'Отмена')
        INTO v_total_leads, v_open_leads, v_signed_leads, v_cancelled_leads
        FROM public.leads
        WHERE assigned_to = p_user_id;
    ELSIF p_role = 'smm' AND p_user_id IS NOT NULL THEN
        SELECT 
            count(*),
            count(*) FILTER (WHERE status = 'Открыт'),
            count(*) FILTER (WHERE status = 'Подписан'),
            count(*) FILTER (WHERE status = 'Отмена')
        INTO v_total_leads, v_open_leads, v_signed_leads, v_cancelled_leads
        FROM public.leads
        WHERE created_by = p_user_id;
    ELSE
        SELECT 
            count(*),
            count(*) FILTER (WHERE status = 'Открыт'),
            count(*) FILTER (WHERE status = 'Подписан'),
            count(*) FILTER (WHERE status = 'Отмена')
        INTO v_total_leads, v_open_leads, v_signed_leads, v_cancelled_leads
        FROM public.leads;
    END IF;

    -- Метрики продавцов
    SELECT 
        count(*) FILTER (WHERE is_active = true),
        COALESCE(sum(balance), 0)
    INTO v_active_sellers, v_total_balance
    FROM public.sellers;

    -- Общее количество закреплений
    SELECT count(*) INTO v_total_connections FROM public.connections;

    -- Сумма выплат за текущий месяц
    SELECT COALESCE(sum(amount), 0) INTO v_month_payouts
    FROM public.employee_payouts
    WHERE accrual_month = v_month;

    RETURN jsonb_build_object(
        'total_leads', COALESCE(v_total_leads, 0),
        'open_leads', COALESCE(v_open_leads, 0),
        'signed_leads', COALESCE(v_signed_leads, 0),
        'cancelled_leads', COALESCE(v_cancelled_leads, 0),
        'conversion_rate', CASE 
            WHEN COALESCE(v_total_leads, 0) > 0 
            THEN round((COALESCE(v_signed_leads, 0)::numeric / v_total_leads::numeric) * 100, 1) 
            ELSE 0 
        END,
        'active_sellers', COALESCE(v_active_sellers, 0),
        'total_sellers_balance', COALESCE(v_total_balance, 0),
        'total_connections', COALESCE(v_total_connections, 0),
        'month_payouts', COALESCE(v_month_payouts, 0)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kpi(UUID, TEXT, TEXT) TO authenticated;

-- 6. SQL-агрегат для расчета выплат и бонусов без передачи сырых строк в Node.js
CREATE OR REPLACE FUNCTION public.calculate_payout_accruals(
    p_accrual_month VARCHAR(7),
    p_employee_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conn_bonus NUMERIC(12,2) := 0;
    v_conn_count INT := 0;
    v_maint_bonus NUMERIC(12,2) := 0;
    v_maint_count INT := 0;
BEGIN
    IF p_employee_id IS NOT NULL THEN
        SELECT COALESCE(sum(connection_fee_amount), 0), count(*)
        INTO v_conn_bonus, v_conn_count
        FROM public.connections
        WHERE accrual_month = p_accrual_month AND manager_id = p_employee_id;

        SELECT COALESCE(sum(maintenance_amount), 0), count(*)
        INTO v_maint_bonus, v_maint_count
        FROM public.client_maintenance
        WHERE accrual_month = p_accrual_month AND manager_id = p_employee_id;
    ELSE
        SELECT COALESCE(sum(connection_fee_amount), 0), count(*)
        INTO v_conn_bonus, v_conn_count
        FROM public.connections
        WHERE accrual_month = p_accrual_month;

        SELECT COALESCE(sum(maintenance_amount), 0), count(*)
        INTO v_maint_bonus, v_maint_count
        FROM public.client_maintenance
        WHERE accrual_month = p_accrual_month;
    END IF;

    RETURN jsonb_build_object(
        'accrual_month', p_accrual_month,
        'employee_id', p_employee_id,
        'total_connection_bonus', v_conn_bonus,
        'total_maintenance_bonus', v_maint_bonus,
        'total_accrued', v_conn_bonus + v_maint_bonus,
        'calculated_records', v_conn_count + v_maint_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_payout_accruals(VARCHAR, UUID) TO authenticated;
