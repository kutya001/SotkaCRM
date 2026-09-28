-- ==============================================================================
-- Миграция 025: Снятие уникального ограничения sellers_organization_id_key
-- В таблице sellers первичным ключом является seller_phone.
-- Во внешнем API Sotka несколько магазинов/номеров могут принадлежать
-- одной организации (organization_id), либо один номер может иметь несколько записей.
-- Ограничение sellers_organization_id_key блокировало upsert продавцов (HTTP 500).
-- Заменяем уникальное ограничение на обычный btree индекс для быстрого поиска.
-- ==============================================================================

ALTER TABLE public.sellers DROP CONSTRAINT IF EXISTS sellers_organization_id_key;

CREATE INDEX IF NOT EXISTS idx_sellers_organization_id ON public.sellers(organization_id);

NOTIFY pgrst, 'reload schema';
