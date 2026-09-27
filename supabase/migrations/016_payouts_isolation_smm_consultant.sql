-- ==============================================================================
-- Миграция 016: Строгая изоляция выплат для ролей SMM и Консультантов
-- Добавление статуса выплат, алиаса employee_id и ужесточение политики RLS
-- ==============================================================================

-- 1. Добавление колонки статуса выплат в employee_payouts
ALTER TABLE public.employee_payouts
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'paid';

-- Добавление колонки employee_id как псевдонима/внешнего ключа на users(user_id)
ALTER TABLE public.employee_payouts
ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE;

-- Синхронизация исторических данных
UPDATE public.employee_payouts
SET employee_id = user_id
WHERE employee_id IS NULL;

-- 2. Индекс для быстрой выборки по статусу и сотруднику
CREATE INDEX IF NOT EXISTS idx_employee_payouts_status_user
ON public.employee_payouts(user_id, status);

CREATE INDEX IF NOT EXISTS idx_employee_payouts_employee_status
ON public.employee_payouts(employee_id, status);

-- 3. Триггер автосинхронизации user_id <-> employee_id и значения по умолчанию
CREATE OR REPLACE FUNCTION public.trg_sync_payout_employee_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id IS NULL AND NEW.employee_id IS NOT NULL THEN
        NEW.user_id := NEW.employee_id;
    ELSIF NEW.employee_id IS NULL AND NEW.user_id IS NOT NULL THEN
        NEW.employee_id := NEW.user_id;
    END IF;

    IF NEW.status IS NULL OR TRIM(NEW.status) = '' THEN
        NEW.status := 'paid';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_payout_employee_id_trigger ON public.employee_payouts;
CREATE TRIGGER sync_payout_employee_id_trigger
BEFORE INSERT OR UPDATE ON public.employee_payouts
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_payout_employee_id();

-- 4. Обновление политики безопасности RLS для таблицы выплат
ALTER TABLE public.employee_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_select_policy" ON public.employee_payouts;

CREATE POLICY "payouts_select_policy" ON public.employee_payouts
FOR SELECT TO authenticated
USING (
    -- Администраторы и руководители видят все выплаты
    (
        COALESCE(
            (SELECT public.get_current_user_role())::text,
            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
        ) IN ('admin', 'supervisor')
    )
    OR
    -- SMM и Консультанты видят ТОЛЬКО свои выплаты и ТОЛЬКО со статусом 'paid'
    (
        (
            user_id = public.get_current_crm_user_id()
            OR employee_id = public.get_current_crm_user_id()
            OR user_id IN (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
        )
        AND status = 'paid'
        AND (
            COALESCE(
                (SELECT public.get_current_user_role())::text,
                (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
            ) IN ('consultant', 'smm')
        )
    )
);

-- Сохраняем политику записи только для администраторов
DROP POLICY IF EXISTS "payouts_admin_modify_policy" ON public.employee_payouts;

CREATE POLICY "payouts_admin_modify_policy" ON public.employee_payouts
FOR ALL TO authenticated
USING (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) = 'admin'
)
WITH CHECK (
    COALESCE(
        (SELECT public.get_current_user_role())::text,
        (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)
    ) = 'admin'
);

-- 5. Представление public.payouts для зеркальной совместимости
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
GRANT ALL ON public.employee_payouts TO authenticated;

-- Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
