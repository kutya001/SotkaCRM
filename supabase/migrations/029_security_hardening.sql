-- ==============================================================================
-- 029_security_hardening.sql
-- Закрытие прямого доступа к БД в обход приложения (PostgREST + anon/JWT из браузера)
--
-- 1. anon: отзыв всех прав в схеме public (CRM не имеет публичных данных)
-- 2. SECURITY DEFINER RPC с деньгами/чужими данными: только service_role.
--    Приложение вызывает их через createAdminClient() ПОСЛЕ серверной проверки прав.
-- 3. Представления employees / connections_with_accruals: security_invoker + запрет записи
-- 4. rates: включение RLS
-- 5. connections: запись только для admin (ранее consultant мог менять суммы и manager_id)
-- 6. Блокировка сотрудника: роль убирается из JWT, учетная запись банится в GoTrue,
--    get_current_user_role() проверяет is_active на каждом запросе
-- 7. payment_method: разрешено значение 'система' (DEFAULT из 027 нарушал CHECK)
--
-- Миграция идемпотентна и не зависит от того, какие перегрузки функций существуют в БД.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. anon: никаких прав в public
-- ------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Политика, открывавшая anon чтение всех сотрудников (логины, телефоны)
DROP POLICY IF EXISTS users_anon_select_policy ON public.users;

-- ------------------------------------------------------------------------------
-- 2. Серверные RPC: только service_role (все перегрузки)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_crm_user',
        'process_employee_payout_atomic',
        'run_maintenance_billing',
        'process_unified_connection_accruals',
        'accrue_all_connections_bonuses',
        'accrue_connection_bonuses_v2',
        'accrue_selected_connections',
        'sync_missing_connection_accruals',
        'calculate_payout_accruals',
        'get_payouts_summary',
        'get_employee_payroll_sheet',
        'get_dashboard_kpi',
        'link_lead_to_seller',
        'unlink_lead_and_seller'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Представления: выполнение с правами вызывающего (RLS базовых таблиц) и только чтение
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY['employees', 'connections_with_accruals', 'payouts'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v'
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', v);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 4. rates: RLS (читают все сотрудники, изменяет только admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.rates') IS NOT NULL THEN
    ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS rates_select_policy ON public.rates;
    CREATE POLICY rates_select_policy ON public.rates
      FOR SELECT TO authenticated
      USING (true);

    DROP POLICY IF EXISTS rates_admin_write_policy ON public.rates;
    CREATE POLICY rates_admin_write_policy ON public.rates
      FOR ALL TO authenticated
      USING ((SELECT public.get_current_user_role()) = 'admin')
      WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. connections: запись только admin
--    Консультанты создают подключения только через link_lead_to_seller (сервер + service_role)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS connections_admin_write_policy ON public.connections;
CREATE POLICY connections_admin_write_policy ON public.connections
  FOR ALL TO authenticated
  USING ((SELECT public.get_current_user_role()) = 'admin')
  WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

-- ------------------------------------------------------------------------------
-- 6. Блокировка сотрудников
-- ------------------------------------------------------------------------------

-- Роль и CRM-идентификатор берутся из таблицы users с проверкой is_active.
-- JWT app_metadata не используется: access token живет до часа после блокировки.
-- В политиках функции обернуты в (SELECT ...) и вычисляются один раз на запрос.
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.users
  WHERE auth_id = (SELECT auth.uid()) AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_current_crm_user_id()
RETURNS UUID AS $$
  SELECT user_id FROM public.users
  WHERE auth_id = (SELECT auth.uid()) AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Синхронизация в auth.users: у заблокированного роль в app_metadata = null,
-- а banned_until не дает обновить токен или войти заново.
CREATE OR REPLACE FUNCTION public.sync_user_app_metadata()
RETURNS trigger AS $$
DECLARE
  v_activity_changed BOOLEAN := TG_OP = 'INSERT';
BEGIN
  IF NEW.auth_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_activity_changed := OLD.is_active IS DISTINCT FROM NEW.is_active
      OR OLD.auth_id IS DISTINCT FROM NEW.auth_id;
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) ||
        jsonb_build_object(
          'role', CASE WHEN NEW.is_active THEN NEW.role END,
          'user_id', NEW.user_id,
          'full_name', NEW.full_name
        ),
      banned_until = CASE
        WHEN NOT v_activity_changed THEN banned_until
        WHEN NEW.is_active THEN NULL
        ELSE now() + INTERVAL '100 years'
      END
  WHERE id = NEW.auth_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_user_app_metadata ON public.users;
CREATE TRIGGER trg_sync_user_app_metadata
AFTER INSERT OR UPDATE OF role, is_active, auth_id, full_name ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_app_metadata();

-- Применяем к уже заблокированным сотрудникам
UPDATE auth.users au
SET raw_app_meta_data = COALESCE(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NULL),
    banned_until = now() + INTERVAL '100 years'
FROM public.users u
WHERE u.auth_id = au.id
  AND u.is_active = false;

-- ------------------------------------------------------------------------------
-- 7. payment_method: системные начисления используют 'система'
--    (027 выставил DEFAULT 'система', а CHECK из 017/018 его отклонял)
-- ------------------------------------------------------------------------------
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS employee_payouts_payment_method_check;
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS payouts_payment_method_check;
ALTER TABLE public.employee_payouts DROP CONSTRAINT IF EXISTS chk_payment_method_payout;
ALTER TABLE public.employee_payouts
  ADD CONSTRAINT chk_payment_method_payout
  CHECK (payment_method IS NULL OR payment_method IN ('mbank', 'odengi', 'bakai', 'abank', 'cash', 'система'))
  NOT VALID;
