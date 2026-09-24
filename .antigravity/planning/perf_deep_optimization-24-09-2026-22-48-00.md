# План реализации: Комплексная оптимизация производительности (RLS Cache, Server Caching, Dynamic Imports & Table Memo)

## 1. Контекст и архитектурные цели
Цель задачи — радикальное ускорение отклика SotkaCRM на стороне PostgreSQL, серверного слоя Next.js и клиентского рендера UI.

Оптимизация охватывает 4 уровня:
1. **СУБД / RLS (PostgreSQL 17 на Supabase):**
   - Устранение N-кратного вызова функций аутентификации на каждую строку (`auth.uid()`, `get_current_user_role()`, `get_current_crm_user_id()`) через обертку `(SELECT ...)`.
   - Добавление композитных B-Tree индексов для ускорения поиска, фильтрации и сортировки в реестрах `leads`, `sellers`, `connections`, `users`.
   - Актуализация документа физической схемы `DB.md`.
2. **Серверное кэширование справочников (Next.js Data Cache):**
   - Кэширование `getEmployees()` через `unstable_cache` с тегом `'employees'` и TTL 300 сек.
   - Инвалидация через `revalidateTag('employees')` при любых мутациях (`createEmployee`, `updateEmployee`, `toggleEmployeeActive`, `resetEmployeePassword`).
   - Кэширование `getEmployeeRates()` с тегом `'rates'` и инвалидацией `revalidateTag('rates')`.
   - Кэширование `getPlans()` с тегом `'plans'` и инвалидацией `revalidateTag('plans')`.
3. **Клиентский бандл и Code Splitting (Next.js Dynamic Imports):**
   - Ленивая загрузка `LeadSellerMappingModal` и `SalesScriptsSheet` в `app/leads/page.tsx` через `next/dynamic` с `{ ssr: false }`.
   - Ленивая загрузка `LinkSellerLeadModal` в `app/sellers/page.tsx` через `next/dynamic` с `{ ssr: false }`.
   - Условный рендеринг модальных окон только при `isOpen === true` (исключение лишних DOM-узлов в фоне).
4. **Мемоизация и изоляция событий таблицы (`components/ui/DataJournal.tsx`):**
   - Компонент `DataJournalRow` с мемоизацией через `React.memo` и компаратором по `item.id`, `status`, `assigned_to`, `updated_at`, `manager_id`, `is_active`, `moderation`.
   - Изоляция состояния контекстного меню ПКМ: вынос управления в изолированный компонент-слой, исключающий ре-рендер родительского `DataJournal` и всей таблицы из 50+ строк при открытии контекстного меню.

---

## 2. Пошаговый план внедрения

### Этап 1: Создание миграции 012 и применение к Supabase
- Создать `supabase/migrations/012_perf_rls_cache_and_composite_indexes.sql`:
  - Пересоздание политик безопасности с `(SELECT auth.uid())`, `(SELECT public.get_current_user_role())`, `(SELECT public.get_current_crm_user_id())`.
  - Очистка устаревших дублирующих политик (`payouts_admin_modify_policy`, `payouts_select_policy`).
  - Создание индексов:
    - `idx_leads_status_created` (leads(status, created_at DESC))
    - `idx_leads_assigned_status` (leads(assigned_to, status))
    - `idx_sellers_moderation_reg` (sellers(moderation, registered_at DESC))
    - `idx_connections_seller_phone` (connections(seller_phone))
    - `idx_users_role_active` (users(role, is_active))
- Применить миграцию через MCP-инструмент `execute_sql` к проекту `qfsfgthlbjacxyxuvrnr`.
- Синхронизировать изменения в `DB.md`.

### Этап 2: Кэширование справочников в Server Actions
- **`app/employees/actions.ts`**:
  - Выделить чистую выборку активных/всех сотрудников в `fetchCachedEmployees`, обернутую в `unstable_cache(..., ['employees-list'], { tags: ['employees'], revalidate: 300 })`.
  - Добавить `revalidateTag('employees')` во все мутации сотрудников.
- **`app/rates/actions.ts`**:
  - Обернуть запрос `fetchCachedEmployeeRates` в `unstable_cache(..., ['rates-list'], { tags: ['rates'], revalidate: 300 })`.
  - Добавить `revalidateTag('rates')` в `upsertEmployeeRate`, `deleteEmployeeRatePeriod`, `deleteEmployeeRate`.
- **`app/plans/actions.ts`**:
  - Обернуть выборку планов `fetchCachedPlans` в `unstable_cache(..., ['plans-list'], { tags: ['plans'], revalidate: 300 })`.
  - Добавить `revalidateTag('plans')` во все мутации тарифов.

### Этап 3: Code Splitting и динамический импорт модалок
- **`app/leads/page.tsx`**:
  - Заменить прямые импорты на `dynamic(() => import(...), { ssr: false })` для `LeadSellerMappingModal` и `SalesScriptsSheet`.
  - Убедиться, что они монтируются только при `isOpen === true`.
- **`app/sellers/page.tsx`**:
  - Заменить прямой импорт на `dynamic(() => import(...), { ssr: false })` для `LinkSellerLeadModal`.
  - Монтировать только при `linkLeadModal.isOpen === true`.

### Этап 4: Мемоизация строк и изоляция контекстного меню в DataJournal
- Создать компонент `DataJournalRow` с предикатом `areRowPropsEqual`:
  - Сравнение ключевых идентификаторов и мутабельных полей (`status`, `assigned_to`, `updated_at`, `manager_id`, `is_active`, `moderation`).
  - Проверка локального состояния дропдауна статуса и бейджа копирования для данной строки.
- Вынести `ContextMenu` в изолированный подкомпонент с локальной подпиской или изолированным стейтом, предотвращающим каскадный рендер таблицы.

### Этап 5: Верификация и фиксация
- Проверка типов: `npx tsc --noEmit`.
- Проверка производственной сборки: `npm run build`.
- Создание отчета верификации в `.antigravity/results/`.
- Коммит изменений в Git.
