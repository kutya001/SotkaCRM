-- ==============================================================================
-- МИГРАЦИЯ 023: Исправление RLS employee_payouts и синхронизация connection_accruals → employee_payouts
-- ==============================================================================

-- 1. Исправление RLS-политики: замена несуществующей функции get_current_user_id() на get_current_crm_user_id()
DROP POLICY IF EXISTS "employee_payouts_select_policy" ON public.employee_payouts;
DROP POLICY IF EXISTS "employee_payouts_read_policy" ON public.employee_payouts;
DROP POLICY IF EXISTS "payouts_select_role_isolated" ON public.employee_payouts;

CREATE POLICY "employee_payouts_select_policy" ON public.employee_payouts
FOR SELECT TO authenticated
USING (
  (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
  OR
  user_id = (SELECT public.get_current_crm_user_id())
  OR
  employee_id = (SELECT public.get_current_crm_user_id())
);

-- 2. Политика модификации (INSERT/UPDATE/DELETE) — только admin/supervisor
DROP POLICY IF EXISTS "payouts_admin_modify" ON public.employee_payouts;
DROP POLICY IF EXISTS "employee_payouts_modify_policy" ON public.employee_payouts;

CREATE POLICY "employee_payouts_modify_policy" ON public.employee_payouts
FOR ALL TO authenticated
USING (
  (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
)
WITH CHECK (
  (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
);

-- 3. Добавление недостающих колонок (если ещё нет) для совместимости с batch/accrue-all
ALTER TABLE public.employee_payouts
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed';

-- 4. Backfill: синхронизация незакреплённых записей connection_accruals → employee_payouts
-- Вставляем записи из connection_accruals, которые ещё не имеют корреспондирующей строки в employee_payouts
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
)
SELECT
  ca.employee_id,
  ca.employee_id,
  ca.connection_id,
  ca.seller_phone,
  '+',
  CASE ca.accrual_type WHEN 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END,
  'бонус',
  ca.amount,
  ca.settlement_month,
  ca.settlement_month,
  COALESCE(ca.created_at::date, CURRENT_DATE),
  COALESCE(ca.created_at::date, CURRENT_DATE),
  'completed',
  ca.notes,
  ca.notes,
  ca.employee_id
FROM public.connection_accruals ca
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_payouts ep
  WHERE ep.connection_id = ca.connection_id
    AND ep.operation_type = CASE ca.accrual_type WHEN 'connection' THEN 'accrual_connection' ELSE 'accrual_maintenance' END
    AND COALESCE(ep.settlement_month, '') = COALESCE(ca.settlement_month, '')
);
