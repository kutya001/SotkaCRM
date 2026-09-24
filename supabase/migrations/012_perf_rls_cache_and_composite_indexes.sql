-- ==============================================================================
-- МИГРАЦИЯ 012: Комплексная оптимизация производительности (RLS Cache & Composite Indexes)
-- ==============================================================================

-- 1. Оптимизация RLS-политик: кеширование вызовов функций аутентификации через (SELECT ...)
-- Исключает N-кратное выполнение функций для каждой строки при сканировании таблиц

-- 1.1. leads
DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
CREATE POLICY "leads_select_policy" ON public.leads
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR ((SELECT public.get_current_user_role()) = 'smm' AND created_by = (SELECT public.get_current_crm_user_id()))
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
);

DROP POLICY IF EXISTS "leads_insert_policy" ON public.leads;
CREATE POLICY "leads_insert_policy" ON public.leads
FOR INSERT TO authenticated
WITH CHECK (
    (SELECT public.get_current_user_role()) IN ('admin', 'smm')
    AND created_by = (SELECT public.get_current_crm_user_id())
);

DROP POLICY IF EXISTS "leads_update_policy" ON public.leads;
CREATE POLICY "leads_update_policy" ON public.leads
FOR UPDATE TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'smm' 
        AND created_by = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Открыт', 'Обработан')
    )
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
)
WITH CHECK (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'smm' 
        AND created_by = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Открыт', 'Обработан')
    )
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
);

-- 1.2. sellers
DROP POLICY IF EXISTS "sellers_select_policy" ON public.sellers;
CREATE POLICY "sellers_select_policy" ON public.sellers
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND (manager_id = (SELECT public.get_current_crm_user_id()) OR manager_id IS NULL)
    )
);

DROP POLICY IF EXISTS "sellers_admin_write_policy" ON public.sellers;
CREATE POLICY "sellers_admin_write_policy" ON public.sellers
FOR ALL TO authenticated
USING ((SELECT public.get_current_user_role()) = 'admin')
WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

-- 1.3. connections
DROP POLICY IF EXISTS "connections_select_policy" ON public.connections;
CREATE POLICY "connections_select_policy" ON public.connections
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND manager_id = (SELECT public.get_current_crm_user_id())
    )
);

DROP POLICY IF EXISTS "connections_admin_write_policy" ON public.connections;
CREATE POLICY "connections_admin_write_policy" ON public.connections
FOR ALL TO authenticated
USING ((SELECT public.get_current_user_role()) IN ('admin', 'consultant'))
WITH CHECK ((SELECT public.get_current_user_role()) IN ('admin', 'consultant'));

-- 1.4. users (employees)
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
CREATE POLICY "users_select_policy" ON public.users
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "users_admin_write_policy" ON public.users;
CREATE POLICY "users_admin_write_policy" ON public.users
FOR ALL TO authenticated
USING ((SELECT public.get_current_user_role()) = 'admin')
WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

-- 1.5. Очистка устаревших неоптимизированных политик employee_payouts & client_maintenance
DROP POLICY IF EXISTS "payouts_admin_modify_policy" ON public.employee_payouts;
DROP POLICY IF EXISTS "payouts_select_policy" ON public.employee_payouts;

DROP POLICY IF EXISTS "client_maintenance_admin_write_policy" ON public.client_maintenance;
CREATE POLICY "client_maintenance_admin_write_policy" ON public.client_maintenance
FOR ALL TO authenticated
USING ((SELECT public.get_current_user_role()) = 'admin')
WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

DROP POLICY IF EXISTS "client_maintenance_select_policy" ON public.client_maintenance;
CREATE POLICY "client_maintenance_select_policy" ON public.client_maintenance
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR manager_id = (SELECT public.get_current_crm_user_id())
);

-- ==============================================================================
-- 2. Композитные B-Tree индексы для быстрой фильтрации и сортировки
-- ==============================================================================

-- 2.1. Фильтрация лидов по статусу с сортировкой по времени создания
CREATE INDEX IF NOT EXISTS idx_leads_status_created 
ON public.leads (status, created_at DESC);

-- 2.2. Фильтрация назначенных лидов конкретного консультанта по статусу
CREATE INDEX IF NOT EXISTS idx_leads_assigned_status 
ON public.leads (assigned_to, status);

-- 2.3. Сортировка и фильтрация продавцов по статусу модерации и дате регистрации
CREATE INDEX IF NOT EXISTS idx_sellers_moderation_reg 
ON public.sellers (moderation, registered_at DESC);

-- 2.4. Индекс внешнего ключа продавца в подключениях
CREATE INDEX IF NOT EXISTS idx_connections_seller_phone 
ON public.connections (seller_phone);

-- 2.5. Выборка активных сотрудников по ролям
CREATE INDEX IF NOT EXISTS idx_users_role_active 
ON public.users (role, is_active);
