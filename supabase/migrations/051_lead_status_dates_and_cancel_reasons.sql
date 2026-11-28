-- ==============================================================================
-- 051_lead_status_dates_and_cancel_reasons.sql
-- Правила новых статусов лида (после 050):
--  - meeting_at — дата и время встречи (обязательна в статусе «Встреча»);
--  - next_contact_at — дата следующего контакта (обязательна в статусе «Перезвонить»);
--    даты сохраняются и после смены статуса (история последней договоренности);
--  - cancel_reason_code — причина отмены из списка (lib/leads/cancel-reasons.ts):
--    no_legal_entity, too_expensive, has_software, no_answer, not_target, other.
--    Текст cancel_reason остается обязательным (триггер 037): API пишет в него название
--    причины и комментарий. Возврат из «Отмена» очищает код вместе с причиной.
--  - RLS UPDATE лидов (страховка прямых запросов): новые статусы в матрице СММ и консультанта.
--  - Права существующим системным ролям: СММ — «Нет ответа»; консультант — «Нет ответа»,
--    «Встреча», «Перезвонить» и «Назначен» (вернуть лид в работу из «Перезвонить» / «Нет ответа»).
-- Выполняется после 050 (в отдельной транзакции). Миграция идемпотентна, без DROP / DELETE.
-- ==============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meeting_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_cancel_reason_code_check' AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_cancel_reason_code_check
      CHECK (cancel_reason_code IS NULL OR cancel_reason_code IN
        ('no_legal_entity', 'too_expensive', 'has_software', 'no_answer', 'not_target', 'other'));
  END IF;
END $$;

-- Списки «Встречи сегодня» и «Перезвонить» сортируются и фильтруются по дате
CREATE INDEX IF NOT EXISTS idx_leads_meeting_at ON public.leads (meeting_at) WHERE status = 'Встреча';
CREATE INDEX IF NOT EXISTS idx_leads_next_contact_at ON public.leads (next_contact_at) WHERE status = 'Перезвонить';
CREATE INDEX IF NOT EXISTS idx_leads_cancel_reason_code ON public.leads (cancel_reason_code) WHERE status = 'Отмена';

-- 1. Дата обязательна для «Встреча» и «Перезвонить»; код причины живет только в «Отмена»
CREATE OR REPLACE FUNCTION public.leads_enforce_status_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'Встреча' AND NEW.meeting_at IS NULL THEN
    RAISE EXCEPTION 'Для статуса «Встреча» укажите дату и время встречи'
      USING ERRCODE = 'P0001', HINT = 'meeting_at_required';
  END IF;
  IF NEW.status::text = 'Перезвонить' AND NEW.next_contact_at IS NULL THEN
    RAISE EXCEPTION 'Для статуса «Перезвонить» укажите дату следующего контакта'
      USING ERRCODE = 'P0001', HINT = 'next_contact_at_required';
  END IF;
  IF NEW.status::text <> 'Отмена' THEN
    NEW.cancel_reason_code := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_leads_status_dates
BEFORE INSERT OR UPDATE OF status, meeting_at, next_contact_at, cancel_reason_code ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_enforce_status_dates();

-- 2. RLS UPDATE: матрица ролей с новыми статусами (API проверяет правила сам)
ALTER POLICY leads_update_policy ON public.leads
USING (
  (SELECT public.get_current_user_role()) = 'admin'::user_role
  OR ((SELECT public.get_current_user_role()) = 'smm'::user_role
      AND created_by = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Открыт'::lead_status, 'Нет ответа'::lead_status, 'Обработан'::lead_status]))
  OR ((SELECT public.get_current_user_role()) = 'consultant'::user_role
      AND assigned_to = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Нет ответа'::lead_status, 'Назначен'::lead_status, 'Встреча'::lead_status,
                              'Перезвонить'::lead_status, 'Подписан'::lead_status, 'Отмена'::lead_status]))
)
WITH CHECK (
  (SELECT public.get_current_user_role()) = 'admin'::user_role
  OR ((SELECT public.get_current_user_role()) = 'smm'::user_role
      AND created_by = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Открыт'::lead_status, 'Нет ответа'::lead_status, 'Обработан'::lead_status, 'Отмена'::lead_status]))
  OR ((SELECT public.get_current_user_role()) = 'consultant'::user_role
      AND assigned_to = (SELECT public.get_current_crm_user_id())
      AND status = ANY (ARRAY['Нет ответа'::lead_status, 'Назначен'::lead_status, 'Встреча'::lead_status,
                              'Перезвонить'::lead_status, 'Подписан'::lead_status, 'Отмена'::lead_status]))
);

-- 3. Права на новые статусы системным ролям (администратор имеет все через is_admin)
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.role_id, p.permission
FROM public.roles r
JOIN (VALUES
  ('smm', 'leads.status.Нет ответа'),
  ('consultant', 'leads.status.Нет ответа'),
  ('consultant', 'leads.status.Встреча'),
  ('consultant', 'leads.status.Перезвонить'),
  ('consultant', 'leads.status.Назначен')
) AS p(code, permission) ON p.code = r.code
ON CONFLICT (role_id, permission) DO NOTHING;

NOTIFY pgrst, 'reload schema';
