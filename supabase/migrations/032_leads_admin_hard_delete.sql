-- ==============================================================================
-- 032_leads_admin_hard_delete.sql
-- Физическое удаление лидов администратором.
-- В рабочей БД стоял триггер prevent_lead_delete, функция которого (trg_lock_lead_delete)
-- безусловно запрещала DELETE, и не было политики DELETE: часть миграции 020 не была применена.
-- Миграция идемпотентна.
-- ==============================================================================

-- Функция существующего триггера prevent_lead_delete: разрешаем admin и service_role
CREATE OR REPLACE FUNCTION public.trg_lock_lead_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.get_current_user_role() = 'admin' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Удаление лидов разрешено только администратору';
END;
$$;

-- Если триггера нет (новая БД), создаем его
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.leads'::regclass AND tgname = 'prevent_lead_delete'
  ) THEN
    CREATE TRIGGER prevent_lead_delete
    BEFORE DELETE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.trg_lock_lead_delete();
  END IF;
END $$;

-- Триггер из миграции 020 (если применялась) дублирует проверку — делаем его совместимым
CREATE OR REPLACE FUNCTION public.check_lead_deletion_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.get_current_user_role() = 'admin' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Удаление лидов разрешено только администратору';
END;
$$;

-- Политика DELETE только для admin
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'leads_delete_policy'
  ) THEN
    CREATE POLICY leads_delete_policy ON public.leads
      FOR DELETE TO authenticated
      USING ((SELECT public.get_current_user_role()) = 'admin');
  END IF;
END $$;
