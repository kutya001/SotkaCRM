-- ==============================================================================
-- 013_consultant_seller_visibility.sql
-- RBAC: Изоляция базы продавцов для роли Консультант (только approved)
-- и поддержка роли supervisor
-- ==============================================================================

-- 1. Расширение перечисления ролей (добавление роли supervisor)
DO $$ BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Создание представления public.employees для обратной совместимости
CREATE OR REPLACE VIEW public.employees AS
SELECT
    user_id,
    auth_id,
    login,
    full_name,
    phone,
    role,
    color,
    is_active,
    created_at
FROM public.users;

-- 3. Обновление RLS-политики sellers_select_policy
DROP POLICY IF EXISTS "sellers_select_policy" ON public.sellers;
CREATE POLICY "sellers_select_policy" ON public.sellers
FOR SELECT TO authenticated
USING (
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) IN ('admin', 'supervisor')
    )
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'consultant'
        AND moderation = 'approved'
    )
);

-- 4. Обновление функции подсчета статистики KPI продавцов get_sellers_kpi_stats
DROP FUNCTION IF EXISTS public.get_sellers_kpi_stats();
CREATE OR REPLACE FUNCTION public.get_sellers_kpi_stats()
RETURNS jsonb AS $$
DECLARE
    v_role text;
    v_crm_user_id uuid;
    v_result jsonb;
BEGIN
    v_role := public.get_current_user_role()::text;
    v_crm_user_id := public.get_current_crm_user_id();

    IF v_role = 'consultant' THEN
        SELECT jsonb_build_object(
            'total', COUNT(*),
            'active', COUNT(*) FILTER (WHERE is_active = true),
            'pendingModeration', 0,
            'totalBalance', COALESCE(SUM(balance), 0),
            'assigned', COUNT(*) FILTER (WHERE manager_id = v_crm_user_id)
        ) INTO v_result
        FROM public.sellers
        WHERE moderation = 'approved';
    ELSE
        SELECT jsonb_build_object(
            'total', COUNT(*),
            'active', COUNT(*) FILTER (WHERE is_active = true),
            'pendingModeration', COUNT(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', COALESCE(SUM(balance), 0),
            'assigned', COUNT(*) FILTER (WHERE manager_id IS NOT NULL)
        ) INTO v_result
        FROM public.sellers;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
