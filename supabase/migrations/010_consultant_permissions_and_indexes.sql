-- ==============================================================================
-- МИГРАЦИЯ 010: Ограничение прав роли Консультант и оптимизация индексов продавцов
-- ==============================================================================

-- 1. Исключение роли 'consultant' из создания лидов в RLS
DROP POLICY IF EXISTS "leads_insert_policy" ON public.leads;
CREATE POLICY "leads_insert_policy" ON public.leads
FOR INSERT TO authenticated
WITH CHECK (
    (SELECT public.get_current_user_role()) IN ('admin', 'smm')
    AND created_by = (SELECT public.get_current_crm_user_id())
);

-- 2. Обновление функции sync_user_app_metadata: сохранение full_name в raw_app_meta_data
CREATE OR REPLACE FUNCTION public.sync_user_app_metadata()
RETURNS trigger AS $$
BEGIN
  IF NEW.auth_id IS NOT NULL THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || 
      jsonb_build_object(
        'role', NEW.role,
        'user_id', NEW.user_id,
        'full_name', NEW.full_name
      )
    WHERE id = NEW.auth_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Фоновое обновление метаданных для существующих активных пользователей
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT auth_id, user_id, role, full_name FROM public.users WHERE auth_id IS NOT NULL AND is_active = true LOOP
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || 
      jsonb_build_object(
        'role', r.role,
        'user_id', r.user_id,
        'full_name', r.full_name
      )
    WHERE id = r.auth_id;
  END LOOP;
END;
$$;

-- 3. Обновление RPC get_sellers_kpi_stats: доступ консультанта к свободным и своим продавцам
CREATE OR REPLACE FUNCTION public.get_sellers_kpi_stats()
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
    v_role := public.get_current_user_role();
    v_user_uuid := public.get_current_crm_user_id();

    IF v_role = 'smm' THEN
        RETURN json_build_object(
            'total', 0,
            'active', 0,
            'pendingModeration', 0,
            'totalBalance', 0,
            'assigned', 0
        );
    ELSIF v_role = 'consultant' THEN
        -- Консультант видит статистику по закрепленным за ним и по свободным продавцам
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pendingModeration', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', COALESCE(sum(balance), 0),
            'assigned', count(*) FILTER (WHERE manager_id = v_user_uuid)
        ) INTO v_result
        FROM public.sellers
        WHERE manager_id = v_user_uuid OR manager_id IS NULL;
    ELSE
        -- Администратор видит глобальную статистику по всей платформе
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pendingModeration', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', COALESCE(sum(balance), 0),
            'assigned', count(*) FILTER (WHERE manager_id IS NOT NULL)
        ) INTO v_result
        FROM public.sellers;
    END IF;

    RETURN v_result;
END;
$$;

-- 4. Обновление RPC get_analytics_summary: синхронизация видимости продавцов для консультанта
CREATE OR REPLACE FUNCTION public.get_analytics_summary(
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role user_role;
    v_user_uuid UUID;
    v_leads_stats JSON;
    v_payouts_stats JSON;
    v_sellers_stats JSON;
BEGIN
    v_role := public.get_current_user_role();
    v_user_uuid := public.get_current_crm_user_id();

    -- Статистика воронки лидов с учетом ролевой изоляции
    IF v_role = 'smm' THEN
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_leads_stats
        FROM public.leads
        WHERE created_by = v_user_uuid
          AND (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    ELSIF v_role = 'consultant' THEN
        SELECT json_build_object(
            'total', count(*) FILTER (WHERE status IN ('Назначен', 'Подписан', 'Отмена')),
            'open', 0,
            'processed', 0,
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_leads_stats
        FROM public.leads
        WHERE assigned_to = v_user_uuid
          AND (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    ELSE
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_leads_stats
        FROM public.leads
        WHERE (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    END IF;

    -- Статистика фонда выплат
    IF v_role = 'admin' THEN
        SELECT json_build_object(
            'totalPaid', coalesce(sum(amount) FILTER (WHERE payout_category != 'удержание'), 0),
            'totalAdvances', coalesce(sum(amount) FILTER (WHERE payout_category = 'аванс'), 0),
            'totalDeductions', coalesce(sum(amount) FILTER (WHERE payout_category = 'удержание'), 0),
            'transactionsCount', count(*)
        ) INTO v_payouts_stats
        FROM public.employee_payouts
        WHERE (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    ELSE
        SELECT json_build_object(
            'totalPaid', coalesce(sum(amount) FILTER (WHERE payout_category != 'удержание'), 0),
            'totalAdvances', coalesce(sum(amount) FILTER (WHERE payout_category = 'аванс'), 0),
            'totalDeductions', coalesce(sum(amount) FILTER (WHERE payout_category = 'удержание'), 0),
            'transactionsCount', count(*)
        ) INTO v_payouts_stats
        FROM public.employee_payouts
        WHERE user_id = v_user_uuid
          AND (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    END IF;

    -- Статистика базы продавцов
    IF v_role = 'smm' THEN
        v_sellers_stats := json_build_object('total', 0, 'active', 0, 'pending', 0, 'totalBalance', 0);
    ELSIF v_role = 'consultant' THEN
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pending', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', coalesce(sum(balance), 0)
        ) INTO v_sellers_stats
        FROM public.sellers
        WHERE manager_id = v_user_uuid OR manager_id IS NULL;
    ELSE
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pending', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', coalesce(sum(balance), 0)
        ) INTO v_sellers_stats
        FROM public.sellers;
    END IF;

    RETURN json_build_object(
        'leads', v_leads_stats,
        'payouts', v_payouts_stats,
        'sellers', v_sellers_stats
    );
END;
$$;

-- 5. Дополнительные B-Tree индексы для ускорения выборок и сортировок продавцов
CREATE INDEX IF NOT EXISTS idx_sellers_manager_synced ON public.sellers (manager_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_sellers_unassigned_synced ON public.sellers (synced_at DESC) WHERE manager_id IS NULL;
