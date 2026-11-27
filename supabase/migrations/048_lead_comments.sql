-- ==============================================================================
-- 048_lead_comments.sql
-- Комментарии к лидам с историей: кто и когда написал.
--  - lead_comments — лента комментариев лида (автор, текст, время). Пишет API
--    (POST /api/v1/leads/{id}/comments) сервисным клиентом после проверки прав;
--    RLS — страховка для прямых запросов: читать можно комментарии видимых лидов,
--    добавлять — от своего имени при праве leads.comment или leads.edit.
--  - leads.comment остается «последним комментарием»: триггер обновляет его при каждом
--    новом комментарии (колонка «Комментарий» реестра и поле карточки лида).
--  - Начальный комментарий нового лида (поле при создании) попадает в ленту триггером
--    с автором — создателем лида.
--  - Перенос: непустой leads.comment существующих лидов становится первым комментарием
--    ленты с is_legacy = true (автор неизвестен, время — последнее изменение лида).
--    Перенос выполняется до создания триггеров, поэтому updated_at лидов не меняется.
-- Миграция идемпотентна. Содержит ON DELETE CASCADE / SET NULL — через Supabase MCP
-- требует ручного подтверждения; проще выполнить целиком в SQL Editor.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.lead_comments (
  comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(lead_id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_comments_body_check CHECK (char_length(btrim(body)) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_lead_comments_lead_created
  ON public.lead_comments (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_comments_author
  ON public.lead_comments (author_id);

-- 1. Перенос прежних комментариев (только лидам без ленты — повторный запуск ничего не дублирует)
INSERT INTO public.lead_comments (lead_id, author_id, body, is_legacy, created_at)
SELECT l.lead_id, NULL, btrim(l.comment), true, COALESCE(l.updated_at, l.created_at, now())
FROM public.leads l
WHERE l.comment IS NOT NULL
  AND btrim(l.comment) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.lead_comments c WHERE c.lead_id = l.lead_id);

-- 2. Новый комментарий становится последним комментарием лида
CREATE OR REPLACE FUNCTION public.lead_comments_sync_latest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
     SET comment = NEW.body,
         updated_at = now()
   WHERE lead_id = NEW.lead_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_lead_comments_sync_latest
AFTER INSERT ON public.lead_comments
FOR EACH ROW EXECUTE FUNCTION public.lead_comments_sync_latest();

-- 3. Комментарий, указанный при создании лида, — первый в ленте (автор — создатель лида)
CREATE OR REPLACE FUNCTION public.leads_initial_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.comment IS NOT NULL AND btrim(NEW.comment) <> '' THEN
    INSERT INTO public.lead_comments (lead_id, author_id, body, created_at)
    VALUES (NEW.lead_id, NEW.created_by, btrim(NEW.comment), COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_leads_initial_comment
AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_initial_comment();

-- 4. RLS: чтение — комментарии видимых лидов; добавление — от своего имени при праве на комментарий
ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_comments' AND policyname = 'lead_comments_select'
  ) THEN
    CREATE POLICY lead_comments_select ON public.lead_comments
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.lead_id = lead_comments.lead_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_comments' AND policyname = 'lead_comments_insert'
  ) THEN
    CREATE POLICY lead_comments_insert ON public.lead_comments
      FOR INSERT TO authenticated
      WITH CHECK (
        author_id = (SELECT public.get_current_crm_user_id())
        AND ((SELECT public.has_permission('leads.comment')) OR (SELECT public.has_permission('leads.edit')))
        AND EXISTS (SELECT 1 FROM public.leads l WHERE l.lead_id = lead_comments.lead_id)
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
