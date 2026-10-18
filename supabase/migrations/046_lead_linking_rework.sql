-- ==============================================================================
-- 046_lead_linking_rework.sql
-- Привязка лида к продавцу: SQL-функции отвечают только за лид, подключение продавца
-- создает и ведет сервер (lib/services/lead-linking.ts → createSellerConnection):
--  - link_lead_to_seller: лид получает продавца, статус «Подписан», ответственного
--    (консультант подключения); продавца и подключение не трогает; лиды со статусом
--    «Подписан» без продавца принимаются (ручная установка статуса больше не предусмотрена);
--  - unlink_lead_and_seller: лид возвращается в «Назначен», ответственный сохраняется;
--    консультанта продавца и подключение ведет сервер (ожидающее подключение снимается,
--    подтвержденное остается).
-- Сигнатуры сохранены (p_confirmation_status теперь не используется). Миграция идемпотентна.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
  p_lead_id UUID,
  p_seller_phone VARCHAR,
  p_user_id UUID DEFAULT NULL,
  p_manager_id UUID DEFAULT NULL,
  p_assigned_by UUID DEFAULT NULL,
  p_confirmation_status TEXT DEFAULT 'confirmed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_seller RECORD;
  v_collision_lead RECORD;
  v_manager_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE lead_id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Лид не найден в системе');
  END IF;
  IF v_lead.seller_phone IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Этот лид уже связан с продавцом +' || v_lead.seller_phone);
  END IF;
  IF v_lead.status = 'Отмена' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нельзя привязать отмененный лид');
  END IF;

  SELECT seller_phone INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
  END IF;

  SELECT lead_id, client_name INTO v_collision_lead
  FROM public.leads WHERE seller_phone = p_seller_phone LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Продавец +' || p_seller_phone || ' уже привязан к другому лиду («' || v_collision_lead.client_name || '»)');
  END IF;

  -- Ответственный за лид — консультант подключения (передает сервер), иначе прежний ответственный
  v_manager_id := COALESCE(p_manager_id, v_lead.assigned_to, p_assigned_by, p_user_id);

  UPDATE public.leads
  SET seller_phone = p_seller_phone,
      status = 'Подписан',
      linked_at = v_now,
      assigned_to = v_manager_id,
      updated_at = v_now
  WHERE lead_id = p_lead_id;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'seller_phone', p_seller_phone,
    'manager_id', v_manager_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.unlink_lead_and_seller(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_seller_phone VARCHAR(50);
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE lead_id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Лид с указанным идентификатором не найден: %', p_lead_id USING ERRCODE = 'P0002';
  END IF;

  v_seller_phone := v_lead.seller_phone;
  IF v_seller_phone IS NULL THEN
    RAISE EXCEPTION 'Лид не привязан к продавцу' USING ERRCODE = '22000';
  END IF;

  -- Лид возвращается в «Назначен», ответственный сохраняется; продавца и подключение ведет сервер
  UPDATE public.leads
  SET seller_phone = NULL,
      linked_at = NULL,
      status = 'Назначен',
      updated_at = now()
  WHERE lead_id = v_lead.lead_id;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead.lead_id,
    'seller_phone', v_seller_phone,
    'new_status', 'Назначен'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_lead_and_seller(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_lead_and_seller(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
