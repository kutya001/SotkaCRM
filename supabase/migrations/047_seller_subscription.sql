-- ==============================================================================
-- 047_seller_subscription.sql
-- Подписка организации на платформе Sotka: какая организация платит подписку, какая нет.
-- Источник — детальная карточка организации Sotka HQ
-- (GET /api/private/v1/admin/sellers-overview/{organization_id}/, блок platform:
-- tariff, subscription_status). Заполняется сервером при обновлении итогов транзакций
-- (lib/services/hq-totals.ts) и при открытии транзакций продавца; синхронизация реестра
-- (upsert sellers) эти колонки не передает и не затирает.
--  - subscription_state: active — подписка действует, inactive — подписки нет,
--    unknown — статус не распознан или еще не проверялся;
--  - hq_subscription_status / hq_tariff / hq_subscription_until — значения Sotka HQ как есть;
--  - hq_subscription_synced_at — когда подписка последний раз сверялась с Sotka HQ.
-- Миграция идемпотентна.
-- ==============================================================================

ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS subscription_state VARCHAR(10) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS hq_subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS hq_tariff TEXT,
  ADD COLUMN IF NOT EXISTS hq_subscription_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hq_subscription_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sellers_subscription_state_check'
      AND conrelid = 'public.sellers'::regclass
  ) THEN
    ALTER TABLE public.sellers
      ADD CONSTRAINT sellers_subscription_state_check
      CHECK (subscription_state IN ('active', 'inactive', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sellers_subscription_state ON public.sellers (subscription_state);

NOTIFY pgrst, 'reload schema';
