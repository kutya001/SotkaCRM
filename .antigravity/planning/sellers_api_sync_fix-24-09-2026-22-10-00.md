# План реализации: Исправление интеграции и парсинга API Продавцов Sotka HQ

- **Дата:** 24-09-2026 22:10:00
- **Статус:** В РАБОТЕ
- **Целевые файлы:**
  - `lib/sotka/types.ts`
  - `lib/sotka/client.ts`
  - `lib/sotka/normalizers.ts`
  - `lib/services/sotka-api.ts`
  - `app/api/sync/sotka/route.ts`
  - `app/sellers/actions.ts`
  - `sotka-api.json`
  - `DB.md`
  - `supabase/migrations/011_sellers_organization_id_unique.sql`

---

## 1. Контекст и выявленные проблемы

1. **Контракт API Sotka HQ:**
   - Список: `GET /api/private/v1/admin/sellers-overview/?offset={offset}&limit={limit}`
   - Детализация: `GET /api/private/v1/admin/sellers-overview/{organization_id}/`
   - Корневой ответ всегда обернут в свойство `detail` (`{ detail: { items: [...], total: ... } }` или `{ detail: { contacts: ..., store: ... } }`).
2. **Параметры пагинации:**
   - Использовать строго `offset` (default 0) и `limit` (default 50, max 200) вместо устаревших `page`/`per_page`.
3. **Распаковка `detail`:**
   - Обработчик HTTP-клиента обязан корректно распаковывать полезную нагрузку из `response.data.detail || response.data`, не интерпретируя ключ `detail` как ошибку.
4. **Нормализация данных:**
   - Преобразование `SotkaSellerOverviewItem` в модель `NormalizedSotkaSeller` со всеми обязательными полями (`organization_id`, `sotka_id`, `name`, `store_name`, `phone`, `moderation_status`, `is_active`, `balance`, `brands`, `plans`, `registered_at`, `last_activity`).
   - Безопасная обработка `null` в `last_activity` без падений.
   - Нормализация телефона до формата `+996XXXXXXXXX` для соответствия первичному ключу `sellers(seller_phone)`.
5. **Синхронизация и сохранение в БД:**
   - Уникальный ключ `organization_id` зафиксирован в PostgreSQL (`CONSTRAINT sellers_organization_id_key UNIQUE (organization_id)`).
   - В Server Action `syncSellersFromSotka` реализован пакетный upsert с сохранением существующих привязок кураторов (`manager_id`).
   - Добавлен Server Action `getSellerDetailFromSotka` для загрузки детальной информации по организации.

---

## 2. Пошаговый план работ

1. **Шаг 1. Фиксация DDL и актуализация документации:**
   - Создать миграцию `supabase/migrations/011_sellers_organization_id_unique.sql`.
   - Актуализировать `DB.md` (добавить `UNIQUE` для `sellers.organization_id`).
   - Актуализировать `sotka-api.json` (детализация продавца `/api/private/v1/admin/sellers-overview/{organization_id}/`, параметры пагинации `offset`/`limit`).
2. **Шаг 2. Обновление типов (`lib/sotka/types.ts`):**
   - Добавить интерфейсы `SotkaSellerOverviewItem`, `SotkaSellersOverviewResponse`, `SotkaSellerDetail`, `SotkaSellerDetailResponse`, `NormalizedSotkaSeller`.
3. **Шаг 3. Доработка клиента (`lib/sotka/client.ts`) и нормализатора (`lib/sotka/normalizers.ts`):**
   - В `client.ts`: обеспечить прозрачную распаковку `detail`, добавить `fetchSotkaDetail`, поддержать строгие пути эндпоинтов.
   - В `normalizers.ts`: добавить `formatSellerPhone`, функцию `normalizeSotkaSeller`, гарантирующую отсутствие `undefined` в `organization_id`, `sotka_id`, `name`, `store`.
4. **Шаг 4. Сервисный слой (`lib/services/sotka-api.ts`):**
   - Обновить `fetchSellersOverview` (параметры `offset = 0`, `limit = 50`).
   - Добавить `fetchSellerDetail(token: string, organizationId: number | string)`.
5. **Шаг 5. Реализация Server Action (`app/sellers/actions.ts`):**
   - Реализовать `syncSellersFromSotka(offset = 0, limit = 50)`:
     - Проверка прав `requireAdmin()`.
     - Сохранение существующих `manager_id`.
     - Резолв тарифов для соблюдения FK `sellers_plan_id_fkey`.
     - Upsert в Supabase по ключу `organization_id` (с fallback на `seller_phone`).
     - Возврат валидного массива нормализованных элементов без `undefined`.
   - Реализовать `getSellerDetailFromSotka(organizationId: number | string)`.
6. **Шаг 6. Обновление Route Handler (`app/api/sync/sotka/route.ts`):**
   - Использовать обновленные функции нормализации и пагинации.
7. **Шаг 7. Верификация и тестирование:**
   - Выполнить проверку типов `npx tsc --noEmit`.
   - Запустить тестовый вызов `syncSellersFromSotka` через скрипт.
   - Проверить сборку `npm run build`.
   - Составить отчет `.antigravity/results/sellers_api_sync_verified-24-09-2026-22-10-00.md`.
