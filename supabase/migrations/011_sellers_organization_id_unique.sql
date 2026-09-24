-- ==============================================================================
-- Миграция 011: Уникальный ключ organization_id для таблицы sellers
-- Обеспечивает возможность безопасного upsert по идентификатору организации
-- из внешнего API Sotka HQ (onConflict: 'organization_id')
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sellers_organization_id_key'
          AND conrelid = 'public.sellers'::regclass
    ) THEN
        ALTER TABLE public.sellers
            ADD CONSTRAINT sellers_organization_id_key UNIQUE (organization_id);
    END IF;
END $$;
