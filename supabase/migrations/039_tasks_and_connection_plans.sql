-- ==============================================================================
-- 039_tasks_and_connection_plans.sql
-- 1. Задачи сотрудников (tasks): статусы Открыт / Назначен / Выполнен / Отложен / Отмена,
--    срок, приоритет, ответственный; уведомление в Telegram при назначении и переназначении.
-- 2. Планы по подключениям (connection_plans): персональные и общие, виды периодов
--    (день / неделя / месяц / квартал / полугодие / год); ставит администратор.
-- 3. Восстановление пароля через Telegram: одноразовые коды (telegram_password_resets).
-- Миграция идемпотентна.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Задачи
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Открыт',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal',
  assigned_to UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  result_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tasks_status_check CHECK (status IN ('Открыт', 'Назначен', 'Выполнен', 'Отложен', 'Отмена')),
  CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'normal', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON public.tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON public.tasks (status, due_date);

-- Статус следует за ответственным: назначение из «Открыт» → «Назначен», снятие из «Назначен» → «Открыт»;
-- «Выполнен» фиксирует completed_at
CREATE OR REPLACE FUNCTION public.tasks_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.status = 'Открыт' THEN
      NEW.status := 'Назначен';
    END IF;
  ELSE
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      IF NEW.assigned_to IS NOT NULL AND NEW.status = 'Открыт' THEN
        NEW.status := 'Назначен';
      ELSIF NEW.assigned_to IS NULL AND NEW.status = 'Назначен' THEN
        NEW.status := 'Открыт';
      END IF;
    END IF;
    NEW.updated_at := now();
  END IF;

  IF NEW.status = 'Выполнен' THEN
    IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_tasks_before_write
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_before_write();

-- Telegram: назначение и переназначение ответственного (самоназначение не уведомляется)
CREATE OR REPLACE FUNCTION public.trg_telegram_on_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author TEXT;
  v_body TEXT;
  v_title TEXT;
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to = public.get_current_crm_user_id() THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_author FROM public.users WHERE user_id = NEW.created_by;

  v_title := CASE WHEN TG_OP = 'INSERT' OR OLD.assigned_to IS NULL THEN 'Вам назначена задача' ELSE 'Вам переназначена задача' END;
  v_body := NEW.title
    || CASE WHEN NEW.due_date IS NOT NULL THEN E'\nСрок: ' || to_char(NEW.due_date, 'DD.MM.YYYY') ELSE '' END
    || CASE WHEN NEW.priority = 'high' THEN E'\nПриоритет: высокий' WHEN NEW.priority = 'low' THEN E'\nПриоритет: низкий' ELSE '' END
    || E'\nПоставил: ' || COALESCE(v_author, '—')
    || CASE WHEN COALESCE(NEW.description, '') <> '' THEN E'\n\n' || left(NEW.description, 500) ELSE '' END;

  PERFORM public.telegram_enqueue(NEW.assigned_to, 'tasks', v_title, v_body);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_telegram_on_task_assigned
AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.trg_telegram_on_task_assigned();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tasks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;
GRANT ALL ON TABLE public.tasks TO service_role;

-- Администратор и руководитель видят все задачи; остальные — свои (ответственный или автор)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tasks'::regclass AND polname = 'tasks_select_policy') THEN
    CREATE POLICY tasks_select_policy ON public.tasks
    FOR SELECT TO authenticated
    USING (
      (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
      OR assigned_to = (SELECT public.get_current_crm_user_id())
      OR created_by = (SELECT public.get_current_crm_user_id())
    );
  END IF;
END $$;

-- Создавать: администратор и руководитель — любому; остальные — только себе
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tasks'::regclass AND polname = 'tasks_insert_policy') THEN
    CREATE POLICY tasks_insert_policy ON public.tasks
    FOR INSERT TO authenticated
    WITH CHECK (
      created_by = (SELECT public.get_current_crm_user_id())
      AND (
        (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
        OR assigned_to IS NULL
        OR assigned_to = (SELECT public.get_current_crm_user_id())
      )
    );
  END IF;
END $$;

-- Менять: администратор и руководитель — все; ответственный — свою задачу (статус/комментарий,
-- переназначение запрещено проверкой WITH CHECK)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tasks'::regclass AND polname = 'tasks_update_policy') THEN
    CREATE POLICY tasks_update_policy ON public.tasks
    FOR UPDATE TO authenticated
    USING (
      (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
      OR assigned_to = (SELECT public.get_current_crm_user_id())
      OR created_by = (SELECT public.get_current_crm_user_id())
    )
    WITH CHECK (
      (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
      OR assigned_to = (SELECT public.get_current_crm_user_id())
      OR created_by = (SELECT public.get_current_crm_user_id())
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tasks'::regclass AND polname = 'tasks_delete_policy') THEN
    CREATE POLICY tasks_delete_policy ON public.tasks
    FOR DELETE TO authenticated
    USING (
      (SELECT public.get_current_user_role()) = 'admin'
      OR created_by = (SELECT public.get_current_crm_user_id())
    );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Планы по подключениям
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connection_plans (
  plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(10) NOT NULL DEFAULT 'personal',
  user_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE,
  period_kind VARCHAR(10) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_count INT NOT NULL,
  note TEXT,
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT connection_plans_scope_check CHECK (scope IN ('personal', 'team')),
  CONSTRAINT connection_plans_scope_user_check CHECK ((scope = 'team' AND user_id IS NULL) OR (scope = 'personal' AND user_id IS NOT NULL)),
  CONSTRAINT connection_plans_kind_check CHECK (period_kind IN ('daily', 'weekly', 'monthly', 'quarterly', 'half_year', 'yearly')),
  CONSTRAINT connection_plans_target_check CHECK (target_count > 0),
  CONSTRAINT connection_plans_period_check CHECK (period_end > period_start)
);

-- Один план на сотрудника (или общий) за период данного вида
CREATE UNIQUE INDEX IF NOT EXISTS uq_connection_plans_period
  ON public.connection_plans (scope, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_kind, period_start);
CREATE INDEX IF NOT EXISTS idx_connection_plans_user_period ON public.connection_plans (user_id, period_start, period_end);

CREATE OR REPLACE TRIGGER trg_connection_plans_touch_updated_at
BEFORE UPDATE ON public.connection_plans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.connection_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connection_plans FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connection_plans TO authenticated;
GRANT ALL ON TABLE public.connection_plans TO service_role;

-- Администратор и руководитель видят все планы; консультант — общие и свои
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.connection_plans'::regclass AND polname = 'connection_plans_select_policy') THEN
    CREATE POLICY connection_plans_select_policy ON public.connection_plans
    FOR SELECT TO authenticated
    USING (
      (SELECT public.get_current_user_role()) IN ('admin', 'supervisor')
      OR ((SELECT public.get_current_user_role()) = 'consultant'
          AND (scope = 'team' OR user_id = (SELECT public.get_current_crm_user_id())))
    );
  END IF;
END $$;

-- Ставит планы только администратор
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.connection_plans'::regclass AND polname = 'connection_plans_admin_write_policy') THEN
    CREATE POLICY connection_plans_admin_write_policy ON public.connection_plans
    FOR ALL TO authenticated
    USING ((SELECT public.get_current_user_role()) = 'admin')
    WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Восстановление пароля через Telegram: одноразовые коды (хранится только хеш)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_telegram_password_resets_user ON public.telegram_password_resets (user_id, created_at DESC);

ALTER TABLE public.telegram_password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_password_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_password_resets TO service_role;

NOTIFY pgrst, 'reload schema';
