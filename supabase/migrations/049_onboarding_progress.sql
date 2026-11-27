-- ==============================================================================
-- 049_onboarding_progress.sql
-- Прохождение пошагового обучения по модулям (туры интерфейса, lib/onboarding/tours.ts).
--  - Строка на сотрудника и тур: in_progress — начат, completed — пройден до конца,
--    skipped — пропущен. tour_id = 'all' со статусом skipped — сотрудник отключил
--    обучение целиком (туры больше не запускаются сами).
--  - steps_seen / total_steps — сколько шагов показано из доступных роли сотрудника.
--  - Пишет и читает API (/api/v1/onboarding) сервисным клиентом; RLS — страховка:
--    сотрудник видит и меняет свои строки, право employees.training открывает чтение всех.
-- Миграция идемпотентна. Содержит ON DELETE CASCADE — через Supabase MCP требует
-- ручного подтверждения; проще выполнить целиком в SQL Editor.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  tour_id TEXT NOT NULL,
  status TEXT NOT NULL,
  steps_seen INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  tour_version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_id),
  CONSTRAINT onboarding_progress_status_check CHECK (status IN ('in_progress', 'completed', 'skipped')),
  CONSTRAINT onboarding_progress_steps_check CHECK (steps_seen >= 0 AND total_steps >= 0)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_tour ON public.onboarding_progress (tour_id, status);

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onboarding_progress' AND policyname = 'onboarding_progress_select'
  ) THEN
    CREATE POLICY onboarding_progress_select ON public.onboarding_progress
      FOR SELECT TO authenticated
      USING (
        user_id = (SELECT public.get_current_crm_user_id())
        OR (SELECT public.has_permission('employees.training'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onboarding_progress' AND policyname = 'onboarding_progress_insert'
  ) THEN
    CREATE POLICY onboarding_progress_insert ON public.onboarding_progress
      FOR INSERT TO authenticated
      WITH CHECK (user_id = (SELECT public.get_current_crm_user_id()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onboarding_progress' AND policyname = 'onboarding_progress_update'
  ) THEN
    CREATE POLICY onboarding_progress_update ON public.onboarding_progress
      FOR UPDATE TO authenticated
      USING (user_id = (SELECT public.get_current_crm_user_id()))
      WITH CHECK (user_id = (SELECT public.get_current_crm_user_id()));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
