-- 005_performance_rpcs_and_indexes.sql
-- Высокопроизводительные агрегаты, оптимизация RLS InitPlan и GIN-индексы для поиска

-- 1. Создание хранимой процедуры быстрой агрегации воронки лидов
CREATE OR REPLACE FUNCTION get_leads_funnel_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role user_role;
    v_user_uuid UUID;
    v_result JSON;
BEGIN
    v_role := get_current_user_role();
    v_user_uuid := get_current_crm_user_id();

    IF v_role = 'smm' THEN
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads
        WHERE created_by = v_user_uuid;
    ELSIF v_role = 'consultant' THEN
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads
        WHERE assigned_to = v_user_uuid OR assigned_to IS NULL;
    ELSE
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads;
    END IF;

    RETURN v_result;
END;
$$;

-- 2. Создание хранимой процедуры быстрой агрегации KPI базы продавцов
CREATE OR REPLACE FUNCTION get_sellers_kpi_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role user_role;
    v_result JSON;
BEGIN
    v_role := get_current_user_role();

    IF v_role = 'smm' THEN
        RETURN json_build_object(
            'total', 0,
            'active', 0,
            'pendingModeration', 0,
            'totalBalance', 0,
            'assigned', 0
        );
    END IF;

    SELECT json_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE is_active = true),
        'pendingModeration', count(*) FILTER (WHERE moderation = 'pending'),
        'totalBalance', COALESCE(sum(balance), 0),
        'assigned', count(*) FILTER (WHERE manager_id IS NOT NULL)
    ) INTO v_result
    FROM sellers;

    RETURN v_result;
END;
$$;

-- 3. Оптимизация RLS-политик: кэширование InitPlan через (SELECT ...)
-- Предотвращает вызов функций на каждую строку (per-row execution)

DROP POLICY IF EXISTS "leads_select_policy" ON leads;
CREATE POLICY "leads_select_policy" ON leads
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'smm' AND created_by = (SELECT get_current_crm_user_id()))
    OR ((SELECT get_current_user_role()) = 'consultant' AND (assigned_to = (SELECT get_current_crm_user_id()) OR assigned_to IS NULL))
);

DROP POLICY IF EXISTS "leads_update_policy" ON leads;
CREATE POLICY "leads_update_policy" ON leads
FOR UPDATE TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'consultant' AND (assigned_to = (SELECT get_current_crm_user_id()) OR assigned_to IS NULL))
)
WITH CHECK (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'consultant')
);

DROP POLICY IF EXISTS "sellers_select_policy" ON sellers;
CREATE POLICY "sellers_select_policy" ON sellers
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) IN ('admin', 'consultant')
);

DROP POLICY IF EXISTS "sellers_admin_write_policy" ON sellers;
CREATE POLICY "sellers_admin_write_policy" ON sellers
FOR ALL TO authenticated
USING ((SELECT get_current_user_role()) = 'admin')
WITH CHECK ((SELECT get_current_user_role()) = 'admin');

DROP POLICY IF EXISTS "payments_select_policy" ON payments;
CREATE POLICY "payments_select_policy" ON payments
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) IN ('admin', 'consultant')
);

DROP POLICY IF EXISTS "payments_admin_write_policy" ON payments;
CREATE POLICY "payments_admin_write_policy" ON payments
FOR ALL TO authenticated
USING ((SELECT get_current_user_role()) = 'admin')
WITH CHECK ((SELECT get_current_user_role()) = 'admin');

DROP POLICY IF EXISTS "connections_select_policy" ON connections;
CREATE POLICY "connections_select_policy" ON connections
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'consultant' AND manager_id = (SELECT get_current_crm_user_id()))
);

-- 4. Включение расширения pg_trgm и создание GIN-индексов для подстрочного поиска
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_leads_client_name_trgm ON leads USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm ON leads USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_name_trgm ON sellers USING gin (seller_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_store_trgm ON sellers USING gin (store gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sellers_phone_trgm ON sellers USING gin (seller_phone gin_trgm_ops);

-- 5. Композитные индексы под регулярные выборки
CREATE INDEX IF NOT EXISTS idx_leads_status_created ON leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sellers_mod_active ON sellers (moderation, is_active, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_sellers_manager_active ON sellers (manager_id, is_active);
