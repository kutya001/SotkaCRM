-- ==============================================================================
-- 033_sellers_registration_order.sql
-- Стабильная сортировка реестра продавцов по дате регистрации.
-- organization_seq — числовой ID организации Sotka HQ (растет с регистрацией):
-- служит вторым ключом сортировки, когда Sotka не передала registered_at,
-- и сортирует ID численно («3» раньше «25»), а не как строки.
-- Миграция идемпотентна.
-- ==============================================================================

ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS organization_seq BIGINT
  GENERATED ALWAYS AS (
    CASE WHEN organization_id ~ '^[0-9]{1,18}$' THEN organization_id::bigint END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_sellers_registration_order
  ON public.sellers (registered_at DESC NULLS LAST, organization_seq DESC NULLS LAST, seller_phone);
