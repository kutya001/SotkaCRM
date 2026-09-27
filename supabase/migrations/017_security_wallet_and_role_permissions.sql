-- ==============================================================================
-- Миграция 017: Рефакторинг Кошелька, блокировка DELETE (Admin Only),
-- сквозная изоляция консультанта и гранулярные права SMM на лиды
-- ==============================================================================

-- 1. Рефакторинг платежных методов таблицы employee_payouts
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS employee_payouts_payment_method_check;
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS payouts_payment_method_check;

-- Миграция существующих значений к новому формату кошельков
UPDATE public.employee_payouts
SET payment_method = 'mbank'
WHERE payment_method ILIKE '%mbank%' OR payment_method = 'card_transfer';

UPDATE public.employee_payouts
SET payment_method = 'odengi'
WHERE payment_method ILIKE '%oney%' OR payment_method ILIKE '%деньги%' OR payment_method ILIKE '%о!деньги%';

UPDATE public.employee_payouts
SET payment_method = 'bakai'
WHERE payment_method ILIKE '%bakai%' OR payment_method ILIKE '%бакай%';

UPDATE public.employee_payouts
SET payment_method = 'abank'
WHERE payment_method ILIKE '%abank%' OR payment_method ILIKE '%айыл%' OR payment_method ILIKE '%halyk%';

UPDATE public.employee_payouts
SET payment_method = 'cash'
WHERE payment_method ILIKE '%cash%' OR payment_method ILIKE '%налич%' OR payment_method = 'kaspi';

-- Добавляем проверочное ограничение на 5 платежных систем Кыргызстана
ALTER TABLE public.employee_payouts
ADD CONSTRAINT employee_payouts_payment_method_check
CHECK (payment_method IN ('mbank', 'odengi', 'bakai', 'abank', 'cash'));

-- 2. Глобальный запрет DELETE для всех, кроме Admin
DO $$ 
DECLARE 
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'leads', 
    'sellers', 
    'connections', 
    'employee_payouts', 
    'users', 
    'employee_rates', 
    'plans', 
    'connection_accruals'
  ]) 
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete_policy" ON public.%I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_delete_policy" ON public.%I FOR DELETE TO authenticated USING ((SELECT public.get_current_user_role()) = ''admin'');', tbl, tbl);
  END LOOP;
END $$;

-- 3. Гранулярный доступ SMM и изоляция Консультанта для таблицы leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 3.1. Политика SELECT: SMM видит ВСЕ лиды базы; Консультант видит ТОЛЬКО назначенные ему; Администратор видит ВСЕ
DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;

CREATE POLICY "leads_select_policy" ON public.leads
FOR SELECT TO authenticated
USING (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) IN ('admin', 'supervisor', 'smm')
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'consultant'
        AND (
            assigned_to = public.get_current_crm_user_id()
            OR assigned_to IN (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
        )
    )
);

-- 3.2. Политика UPDATE: SMM может редактировать только со статусом 'Открыт' или 'Обработан'
DROP POLICY IF EXISTS "leads_update_policy" ON public.leads;

CREATE POLICY "leads_update_policy" ON public.leads
FOR UPDATE TO authenticated
USING (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) IN ('admin', 'supervisor')
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'consultant'
        AND (
            assigned_to = public.get_current_crm_user_id()
            OR assigned_to IN (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
        )
    )
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'smm'
        AND status IN ('Открыт', 'Обработан')
    )
)
WITH CHECK (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) IN ('admin', 'supervisor')
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'consultant'
        AND (
            assigned_to = public.get_current_crm_user_id()
            OR assigned_to IN (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
        )
    )
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'smm'
        AND status IN ('Открыт', 'Обработан', 'Назначен')
    )
);

-- 4. Сквозная изоляция продавцов (sellers): консультант видит только СВОИХ одобренных продавцов
DROP POLICY IF EXISTS "sellers_select_policy" ON public.sellers;

CREATE POLICY "sellers_select_policy" ON public.sellers
FOR SELECT TO authenticated
USING (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) IN ('admin', 'supervisor')
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'consultant'
        AND moderation = 'approved'
        AND (
            manager_id = public.get_current_crm_user_id()
            OR manager_id IN (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
        )
    )
);

-- 5. Сквозная изоляция подключений (connections): консультант видит только СВОИ подключения
DROP POLICY IF EXISTS "connections_select_policy" ON public.connections;

CREATE POLICY "connections_select_policy" ON public.connections
FOR SELECT TO authenticated
USING (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) IN ('admin', 'supervisor')
    OR
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) = 'consultant'
        AND (
            manager_id = public.get_current_crm_user_id()
            OR manager_id IN (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
        )
    )
);

-- 6. Обновление представления public.payouts
CREATE OR REPLACE VIEW public.payouts
WITH (security_invoker = true)
AS
SELECT 
    payout_id,
    user_id,
    user_id AS employee_id,
    accrual_month,
    settlement_month,
    payout_date,
    amount,
    payout_category,
    operation_type,
    payment_method,
    comment,
    description,
    status,
    created_by,
    created_at
FROM public.employee_payouts;

GRANT SELECT ON public.payouts TO authenticated;
NOTIFY pgrst, 'reload schema';
