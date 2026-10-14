-- ============================================================================
-- 040: Полноценная ролевая модель (роли и гранулярные права), итоги транзакций Sotka HQ
-- ============================================================================
-- 1. roles — справочник ролей (4 системные роли по умолчанию, редактируемые);
--    role_permissions — права роли (ключи из lib/auth/permissions-catalog.ts).
-- 2. users.role_id — назначенная роль; устаревший enum users.role остается как
--    «базовый профиль» для RLS и статистических RPC и синхронизируется триггером
--    из roles.base_role.
-- 3. Функции has_permission() / get_current_user_permissions() для политик и клиента.
-- 4. sellers.hq_topups_total / hq_charges_total / hq_tx_synced_at — суммы пополнений
--    и списаний по транзакциям Sotka HQ (колонка реестра продавцов).
-- Идемпотентно; без удаления объектов (ограничение инструмента применения).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Роли и права
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  role_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  -- Базовый профиль данных (устаревший enum) для RLS и статистики
  base_role   user_role NOT NULL DEFAULT 'consultant',
  is_system   BOOLEAN NOT NULL DEFAULT false,
  -- Роль с полным доступом: имеет все права всегда, включая добавленные позже
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT roles_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id    UUID NOT NULL REFERENCES public.roles(role_id),
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON public.role_permissions(permission);

-- Системные роли по умолчанию
INSERT INTO public.roles (code, name, description, base_role, is_system, is_admin, sort_order) VALUES
  ('admin',      'Администратор', 'Полный доступ ко всем модулям и настройкам', 'admin',      true, true,  10),
  ('founder',    'Учредитель',    'Просмотр всех данных, задачи и планы',       'supervisor', true, false, 20),
  ('consultant', 'Консультант',   'Работа со своими лидами, продавцами и подключениями', 'consultant', true, false, 30),
  ('smm',        'СММ',           'Создание и обработка лидов',                 'smm',        true, false, 40)
ON CONFLICT (code) DO NOTHING;

-- Права системных ролей (сгенерировано из lib/auth/permissions-catalog.ts; admin — через is_admin)
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.role_id, v.permission
FROM (VALUES
  ('admin', 'dashboard.menu'),
  ('admin', 'leads.menu'),
  ('admin', 'leads.view_all'),
  ('admin', 'leads.create'),
  ('admin', 'leads.edit'),
  ('admin', 'leads.comment'),
  ('admin', 'leads.assign'),
  ('admin', 'leads.status.Открыт'),
  ('admin', 'leads.status.Обработан'),
  ('admin', 'leads.status.Назначен'),
  ('admin', 'leads.status.Подписан'),
  ('admin', 'leads.status.Отмена'),
  ('admin', 'leads.rollback'),
  ('admin', 'leads.link_seller'),
  ('admin', 'leads.unlink_seller'),
  ('admin', 'leads.delete'),
  ('admin', 'leads.bulk'),
  ('admin', 'leads.scripts'),
  ('admin', 'sellers.menu'),
  ('admin', 'sellers.view_all'),
  ('admin', 'sellers.create'),
  ('admin', 'sellers.edit'),
  ('admin', 'sellers.assign'),
  ('admin', 'sellers.take'),
  ('admin', 'sellers.link_lead'),
  ('admin', 'sellers.unlink_lead'),
  ('admin', 'sellers.transactions'),
  ('admin', 'sellers.sync'),
  ('admin', 'sellers.delete'),
  ('admin', 'sellers.bulk'),
  ('admin', 'connections.menu'),
  ('admin', 'connections.view_all'),
  ('admin', 'connections.create'),
  ('admin', 'connections.edit'),
  ('admin', 'connections.confirm'),
  ('admin', 'connections.accrue'),
  ('admin', 'connections.accruals_edit'),
  ('admin', 'connections.delete'),
  ('admin', 'connections.bulk'),
  ('admin', 'payouts.menu'),
  ('admin', 'payouts.view_all'),
  ('admin', 'payouts.create'),
  ('admin', 'payouts.edit'),
  ('admin', 'payouts.status'),
  ('admin', 'payouts.calculate'),
  ('admin', 'payouts.delete'),
  ('admin', 'payouts.bulk'),
  ('admin', 'plans.menu'),
  ('admin', 'plans.manage'),
  ('admin', 'rates.manage'),
  ('admin', 'analytics.menu'),
  ('admin', 'analytics.view_all'),
  ('admin', 'analytics.employees'),
  ('admin', 'analytics.export'),
  ('admin', 'employees.menu'),
  ('admin', 'employees.create'),
  ('admin', 'employees.edit'),
  ('admin', 'employees.deactivate'),
  ('admin', 'employees.reset_password'),
  ('admin', 'employees.roles'),
  ('admin', 'tasks.menu'),
  ('admin', 'tasks.view_all'),
  ('admin', 'tasks.create'),
  ('admin', 'tasks.assign'),
  ('admin', 'tasks.edit_any'),
  ('admin', 'tasks.status_any'),
  ('admin', 'tasks.delete'),
  ('admin', 'goals.menu'),
  ('admin', 'goals.view_all'),
  ('admin', 'goals.manage'),
  ('admin', 'telegram.menu'),
  ('admin', 'telegram.manage'),
  ('admin', 'telegram.broadcast'),
  ('admin', 'docs.menu'),
  ('admin', 'profile.others'),
  ('founder', 'dashboard.menu'),
  ('founder', 'leads.menu'),
  ('founder', 'sellers.menu'),
  ('founder', 'connections.menu'),
  ('founder', 'payouts.menu'),
  ('founder', 'plans.menu'),
  ('founder', 'analytics.menu'),
  ('founder', 'employees.menu'),
  ('founder', 'tasks.menu'),
  ('founder', 'goals.menu'),
  ('founder', 'telegram.menu'),
  ('founder', 'docs.menu'),
  ('founder', 'leads.view_all'),
  ('founder', 'sellers.view_all'),
  ('founder', 'connections.view_all'),
  ('founder', 'payouts.view_all'),
  ('founder', 'analytics.view_all'),
  ('founder', 'tasks.view_all'),
  ('founder', 'goals.view_all'),
  ('founder', 'leads.scripts'),
  ('founder', 'sellers.transactions'),
  ('founder', 'analytics.employees'),
  ('founder', 'analytics.export'),
  ('founder', 'tasks.create'),
  ('founder', 'tasks.assign'),
  ('founder', 'tasks.edit_any'),
  ('founder', 'tasks.status_any'),
  ('founder', 'tasks.delete'),
  ('founder', 'goals.manage'),
  ('founder', 'docs.menu'),
  ('founder', 'profile.others'),
  ('smm', 'leads.menu'),
  ('smm', 'leads.create'),
  ('smm', 'leads.edit'),
  ('smm', 'leads.comment'),
  ('smm', 'leads.status.Открыт'),
  ('smm', 'leads.status.Обработан'),
  ('smm', 'leads.status.Отмена'),
  ('smm', 'leads.rollback'),
  ('smm', 'leads.scripts'),
  ('smm', 'payouts.menu'),
  ('smm', 'tasks.menu'),
  ('smm', 'tasks.create'),
  ('consultant', 'dashboard.menu'),
  ('consultant', 'leads.menu'),
  ('consultant', 'leads.comment'),
  ('consultant', 'leads.status.Подписан'),
  ('consultant', 'leads.status.Отмена'),
  ('consultant', 'leads.link_seller'),
  ('consultant', 'leads.scripts'),
  ('consultant', 'sellers.menu'),
  ('consultant', 'sellers.take'),
  ('consultant', 'sellers.link_lead'),
  ('consultant', 'sellers.transactions'),
  ('consultant', 'connections.menu'),
  ('consultant', 'payouts.menu'),
  ('consultant', 'analytics.menu'),
  ('consultant', 'tasks.menu'),
  ('consultant', 'tasks.create'),
  ('consultant', 'goals.menu')
) AS v(code, permission)
JOIN public.roles r ON r.code = v.code
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. users.role_id: назначенная роль + синхронизация базового enum
-- ----------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.roles(role_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON public.users(role_id);

-- Бэкфилл по устаревшему enum
UPDATE public.users u
SET role_id = r.role_id
FROM public.roles r
WHERE u.role_id IS NULL
  AND r.code = CASE u.role
    WHEN 'admin' THEN 'admin'
    WHEN 'supervisor' THEN 'founder'
    WHEN 'smm' THEN 'smm'
    ELSE 'consultant'
  END;

CREATE OR REPLACE FUNCTION public.fn_users_sync_role()
RETURNS trigger AS $$
DECLARE
  v_base user_role;
BEGIN
  -- role_id не задан (вставка старым кодом / RPC create_crm_user): выводим из enum
  IF NEW.role_id IS NULL THEN
    SELECT role_id INTO NEW.role_id FROM public.roles
    WHERE code = CASE NEW.role
      WHEN 'admin' THEN 'admin'
      WHEN 'supervisor' THEN 'founder'
      WHEN 'smm' THEN 'smm'
      ELSE 'consultant' END
    LIMIT 1;
    RETURN NEW;
  END IF;

  SELECT base_role INTO v_base FROM public.roles WHERE role_id = NEW.role_id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Роль % не найдена', NEW.role_id USING HINT = 'role_not_found';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    -- Назначена роль: enum всегда равен ее базовому профилю
    NEW.role := v_base;
  ELSIF NEW.role IS DISTINCT FROM OLD.role AND NEW.role IS DISTINCT FROM v_base THEN
    -- Изменен только enum (старый код): переводим на системную роль этого профиля
    SELECT role_id INTO NEW.role_id FROM public.roles
    WHERE code = CASE NEW.role
      WHEN 'admin' THEN 'admin'
      WHEN 'supervisor' THEN 'founder'
      WHEN 'smm' THEN 'smm'
      ELSE 'consultant' END
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER trg_users_sync_role
BEFORE INSERT OR UPDATE OF role, role_id ON public.users
FOR EACH ROW EXECUTE FUNCTION public.fn_users_sync_role();

CREATE OR REPLACE FUNCTION public.fn_roles_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_roles_touch_updated_at
BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.fn_roles_touch_updated_at();

-- Смена базового профиля роли переносится на всех ее сотрудников
-- (AFTER: строка roles уже содержит новый base_role, и триггер users не перепривяжет роль)
CREATE OR REPLACE FUNCTION public.fn_roles_base_role_changed()
RETURNS trigger AS $$
BEGIN
  IF NEW.base_role IS DISTINCT FROM OLD.base_role THEN
    UPDATE public.users SET role = NEW.base_role
    WHERE role_id = NEW.role_id AND role IS DISTINCT FROM NEW.base_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER trg_roles_base_role_changed
AFTER UPDATE OF base_role ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.fn_roles_base_role_changed();

-- Защита: системные роли не удаляются, роль с сотрудниками не удаляется
CREATE OR REPLACE FUNCTION public.fn_roles_guard_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Системную роль «%» удалить нельзя', OLD.name USING HINT = 'system_role';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE role_id = OLD.role_id) THEN
    RAISE EXCEPTION 'Роль «%» назначена сотрудникам: сначала переназначьте их', OLD.name USING HINT = 'role_in_use';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER trg_roles_guard_delete
BEFORE DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.fn_roles_guard_delete();

-- Представление employees: роль сотрудника (в конец списка колонок)
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
    role_id
FROM public.users;

-- Как в 029: представление читает users с правами вызывающего (RLS) и не допускает записи
ALTER VIEW public.employees SET (security_invoker = true);
REVOKE INSERT, UPDATE, DELETE ON public.employees FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Функции проверки прав
-- ----------------------------------------------------------------------------
-- Права текущего сотрудника: ['*'] для роли с полным доступом
CREATE OR REPLACE FUNCTION public.get_current_user_permissions()
RETURNS TEXT[] AS $$
  SELECT CASE
    WHEN r.is_admin THEN ARRAY['*']::TEXT[]
    ELSE COALESCE(ARRAY(SELECT rp.permission FROM public.role_permissions rp WHERE rp.role_id = r.role_id ORDER BY 1), '{}'::TEXT[])
  END
  FROM public.users u
  JOIN public.roles r ON r.role_id = u.role_id
  WHERE u.auth_id = (SELECT auth.uid()) AND u.is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role_id = u.role_id
    WHERE u.auth_id = (SELECT auth.uid())
      AND u.is_active = true
      AND (
        r.is_admin
        OR EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.role_id AND rp.permission = p_key)
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_current_user_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_permission(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_permissions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RLS: чтение ролей всем сотрудникам, запись — администратору (и API через service_role)
-- ----------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.roles, public.role_permissions FROM anon;
GRANT SELECT ON public.roles, public.role_permissions TO authenticated;
GRANT ALL ON public.roles, public.role_permissions TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roles' AND policyname = 'roles_select_policy') THEN
    CREATE POLICY roles_select_policy ON public.roles FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roles' AND policyname = 'roles_admin_write_policy') THEN
    CREATE POLICY roles_admin_write_policy ON public.roles FOR ALL TO authenticated
      USING ((SELECT public.get_current_user_role()) = 'admin')
      WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_permissions' AND policyname = 'role_permissions_select_policy') THEN
    CREATE POLICY role_permissions_select_policy ON public.role_permissions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'role_permissions' AND policyname = 'role_permissions_admin_write_policy') THEN
    CREATE POLICY role_permissions_admin_write_policy ON public.role_permissions FOR ALL TO authenticated
      USING ((SELECT public.get_current_user_role()) = 'admin')
      WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Итоги транзакций Sotka HQ в карточке продавца
-- ----------------------------------------------------------------------------
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS hq_topups_total NUMERIC(14,2);
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS hq_charges_total NUMERIC(14,2);
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS hq_tx_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sellers.hq_topups_total IS 'Сумма пополнений по транзакциям Sotka HQ (детальная карточка организации)';
COMMENT ON COLUMN public.sellers.hq_charges_total IS 'Сумма списаний по транзакциям Sotka HQ (по модулю)';
COMMENT ON COLUMN public.sellers.hq_tx_synced_at IS 'Момент последнего обновления итогов транзакций Sotka HQ';

COMMENT ON TABLE public.roles IS 'Роли сотрудников: 4 системные по умолчанию, пользовательские создаются администратором';
COMMENT ON TABLE public.role_permissions IS 'Права роли: ключи каталога lib/auth/permissions-catalog.ts';
COMMENT ON COLUMN public.users.role_id IS 'Назначенная роль (roles); enum role синхронизируется из roles.base_role';

NOTIFY pgrst, 'reload schema';
