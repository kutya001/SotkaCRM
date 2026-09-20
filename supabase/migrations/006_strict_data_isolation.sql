-- 006_strict_data_isolation.sql
-- Строгая ролевая изоляция данных и персональной аналитики для консультантов и SMM
-- В соответствии с GEMINI.md и DB.md

-- 1. Обновление хранимой процедуры агрегации воронки лидов с изоляцией
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
        -- Строгая изоляция: только лиды, назначенные данному консультанту
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads
        WHERE assigned_to = v_user_uuid;
    ELSE
        -- Администратор видит сквозную статистику компании
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

-- 2. Обновление хранимой процедуры агрегации продавцов с изоляцией
CREATE OR REPLACE FUNCTION get_sellers_kpi_stats()
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
        RETURN json_build_object(
            'total', 0,
            'active', 0,
            'pendingModeration', 0,
            'totalBalance', 0,
            'assigned', 0
        );
    ELSIF v_role = 'consultant' THEN
        -- Консультант видит статистику только по закрепленным за ним продавцам
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pendingModeration', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', COALESCE(sum(balance), 0),
            'assigned', count(*) FILTER (WHERE manager_id IS NOT NULL)
        ) INTO v_result
        FROM sellers
        WHERE manager_id = v_user_uuid;
    ELSE
        -- Администратор видит глобальную статистику
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pendingModeration', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', COALESCE(sum(balance), 0),
            'assigned', count(*) FILTER (WHERE manager_id IS NOT NULL)
        ) INTO v_result
        FROM sellers;
    END IF;

    RETURN v_result;
END;
$$;

-- 3. Политики безопасности RLS со строгой изоляцией

DROP POLICY IF EXISTS "leads_select_policy" ON leads;
CREATE POLICY "leads_select_policy" ON leads
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'smm' AND created_by = (SELECT get_current_crm_user_id()))
    OR ((SELECT get_current_user_role()) = 'consultant' AND assigned_to = (SELECT get_current_crm_user_id()))
);

DROP POLICY IF EXISTS "sellers_select_policy" ON sellers;
CREATE POLICY "sellers_select_policy" ON sellers
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'consultant' AND (manager_id = (SELECT get_current_crm_user_id()) OR manager_id IS NULL))
);
