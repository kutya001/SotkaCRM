# Протокол верификации: Исправление интеграции и парсинга API Продавцов Sotka HQ

- **Дата верификации:** 24-09-2026 22:14:00
- **Статус:** ВЕРИФИЦИРОВАНО (Успешно)
- **Целевые файлы:**
  - `lib/sotka/client.ts`
  - `lib/sotka/types.ts`
  - `lib/sotka/normalizers.ts`
  - `lib/services/sotka-api.ts`
  - `app/api/sync/sotka/route.ts`
  - `app/sellers/actions.ts`
  - `sotka-api.json`
  - `DB.md`
  - `supabase/migrations/011_sellers_organization_id_unique.sql`

---

## 1. Выполненные доработки

### 1.1. Модель данных и типы (`lib/sotka/types.ts`)
- Описаны интерфейсы:
  - `SotkaSellerOverviewItem` (строгие поля: `organization_id`, `seller_name`, `seller_phone`, `iso_code`, `store`, `moderation`, `is_active`, `outlets_count`, `employees_count`, `plans`, `brands`, `balance`, `registered_at`, `last_activity`).
  - `SotkaSellersOverviewResponse` (корневой объект с обязательной оберткой в `detail`).
  - `SotkaSellerDetail` и `SotkaSellerDetailResponse` для детальной карточки (`contacts`, `store`, `legal_data`, `platform`, `brands`, `moderation_history`, `transactions`).
  - `NormalizedSotkaSeller` (содержит обязательные поля `sotka_id`, `external_id`, `organization_id`, `name`, `seller_name`, `phone`, `seller_phone`, `store_name`, `store`, `moderation_status`, `is_active`, `outlets_count`, `employees_count`, `balance`, `brands`, `plans`, `registered_at`, `last_activity`, `manager_id`).

### 1.2. HTTP-клиент и сервисный слой (`lib/sotka/client.ts`, `lib/services/sotka-api.ts`)
- Зафиксированы строгие эндпоинты:
  - Реестр: `GET /api/private/v1/admin/sellers-overview/` с параметрами `offset` (default 0) и `limit` (default 50, max 200).
  - Детализация: `GET /api/private/v1/admin/sellers-overview/${organizationId}/`.
- Распаковка данных:
  - Реализован метод `fetchSotkaDetail<T>` с безопасным извлечением полезной нагрузки `rawJson.detail ?? rawJson`.
  - Устранена ложная трактовка ключа `detail` как ошибки: проверка `!response.ok` (HTTP >= 400) изолирована, полезная нагрузка в `detail` при статусе 200 извлекается прозрачно.

### 1.3. Нормализация и санитизация (`lib/sotka/normalizers.ts`)
- Создана функция `formatSellerPhone(phone, isoCode)`: нормализует телефон к международному формату `+996XXXXXXXXX`, согласуясь с первичным ключом таблицы `sellers`.
- Создана функция `normalizeSotkaSeller(item, options)`:
  - `sotka_id` / `external_id` <- `String(item.organization_id)`
  - `name` / `seller_name` <- `item.seller_name || 'Без имени'`
  - `phone` / `seller_phone` <- `formatSellerPhone(item.seller_phone, item.iso_code)`
  - `store_name` / `store` <- `item.store || (stores.join(', ')) || 'Без названия'`
  - `moderation_status` / `moderation` <- `item.moderation || 'pending'`
  - `balance` <- `roundMoney(item.balance)`
  - `registered_at` <- `parseDateToISO(item.registered_at)`
  - `last_activity` <- `parseDateToISO(item.last_activity)` (при `null` возвращает строго `null` без исключений)
  - `manager_id` <- сохранение существующего куратора из БД.

### 1.4. База данных и миграции (`DB.md`, `supabase/migrations/011_sellers_organization_id_unique.sql`)
- Наложен уникальный констрейнт: `CONSTRAINT sellers_organization_id_key UNIQUE (organization_id)`.
- Спецификация зафиксирована в `DB.md`.
- Создана миграция `011_sellers_organization_id_unique.sql`.

### 1.5. Server Actions (`app/sellers/actions.ts`)
- Реализована функция `syncSellersFromSotka(offset = 0, limit = 50)`:
  - Контроль доступа `requireAdmin()`.
  - Сохранение локальных назначений менеджеров `manager_id`.
  - Автоматическая регистрация тарифов в каталоге `plans` для соблюдения FK `sellers_plan_id_fkey`.
  - Пакетный upsert по уникальному ключу `organization_id` (с fallback на `seller_phone`).
  - Ревалидация путей (`/sellers`, `/leads`, `/analytics`, `/`).
- Реализована функция `getSellerDetailFromSotka(organizationId)`.

---

## 2. Результаты тестов и верификации

1. **Тестирование живого API Sotka HQ (Scratch Verification):**
   - Авторизация `authenticateSotkaAdmin`: JWT Bearer получен успешно.
   - Выгрузка `offset = 0, limit = 5`: получено 5 записей, total = 17.
   - Поля `organization_id`, `name`, `store` строго определены (не `undefined`).
   - Пагинация `offset = 5, limit = 5`: получена следующая страница (первый элемент `orgId = 10` вместо `22`).
   - Парсинг `last_activity: null`: возвращает строго `null` без ошибок.
   - Загрузка `fetchSellerDetail`: получен полный профиль организации `orgId = 22` (`contacts`, `store`, `legal_data`).
2. **TypeScript (`npx tsc --noEmit`):**
   - 0 ошибок компиляции типов.
3. **Next.js Production Build (`npm run build`):**
   - Все 16 маршрутов приложения скомпилированы успешно.
