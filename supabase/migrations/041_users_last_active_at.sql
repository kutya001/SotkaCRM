-- ============================================================================
-- 041: Последняя активность сотрудника (users.last_active_at)
-- ============================================================================
-- Отметка обновляется сервером при любом авторизованном запросе не чаще раза в 5 минут
-- (lib/auth/check-role.ts) и показывается в профиле и в реестре сотрудников.
-- Идемпотентно; без удаления объектов.
-- ============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
COMMENT ON COLUMN public.users.last_active_at IS 'Последняя активность в CRM (авторизованный запрос), обновляется не чаще раза в 5 минут';

-- Представление employees: новая колонка в конце списка
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
    created_at,
    role_id,
    last_active_at
FROM public.users;

-- Как в 029: представление читает users с правами вызывающего (RLS) и не допускает записи
ALTER VIEW public.employees SET (security_invoker = true);
REVOKE INSERT, UPDATE, DELETE ON public.employees FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
