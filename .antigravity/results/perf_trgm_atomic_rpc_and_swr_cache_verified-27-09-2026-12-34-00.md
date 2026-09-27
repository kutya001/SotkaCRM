# Отчет о верификации: Оптимизация производительности (Trigram GIN, Атомарный RPC, SWR Кэш, DataJournal Memoization)

**Дата:** 27-09-2026 12:34:00  
**Статус:** Успешно завершено (Verified / Exit Code 0)  
**Ветки и сборка:** `main`, Next.js 15.5.25 (Production Build: 43/43 routes)

---

## 1. Сводка выполненных работ

### 1.1 База данных Supabase (PostgreSQL 15+)
* **Миграция `014_trgm_search_and_atomic_linking.sql`:**
  * Активировано системное расширение `pg_trgm`.
  * Созданы 4 GIN-триграммных индекса на таблице `leads`:
    * `idx_leads_client_name_trgm` (`client_name gin_trgm_ops`)
    * `idx_leads_phone_trgm` (`phone gin_trgm_ops`)
    * `idx_leads_comment_trgm` (`comment gin_trgm_ops`)
    * `idx_leads_composite_search_trgm` (`(client_name || ' ' || COALESCE(phone, '') || ' ' || COALESCE(comment, '')) gin_trgm_ops`)
  * Созданы 4 GIN-триграммных индекса на таблице `sellers`:
    * `idx_sellers_seller_name_trgm` (`seller_name gin_trgm_ops`)
    * `idx_sellers_seller_phone_trgm` (`seller_phone gin_trgm_ops`)
    * `idx_sellers_store_trgm` (`store gin_trgm_ops`)
    * `idx_sellers_composite_search_trgm` (`(seller_name || ' ' || COALESCE(seller_phone, '') || ' ' || COALESCE(store, '')) gin_trgm_ops`)
  * **Атомарная RPC-процедура `link_lead_to_seller`:**
    * Блокировка `SELECT ... FOR UPDATE` по строкам лида и продавца.
    * Валидация исключений: коллизии занятости продавца, статус `Подписан`, статус `Отмена`.
    * Автоматический расчет бонуса за первичное подключение на базе `employee_rates` и цены тарифа `plans`.
    * Атомарная фиксация связки в `leads`, `sellers` и создание записи в `connections`.
  * **SQL-агрегат `get_dashboard_kpi`:**
    * Сбор всех счетчиков воронки лидов (`FILTER (WHERE status = ...)`), метрик продавцов, общего баланса, закреплений и выплат месяца за 1 сетевой раундтрип.
  * **SQL-агрегат `calculate_payout_accruals`:**
    * Суммирование комиссий за подключение (`connections`) и сопровождение (`client_maintenance`) на стороне PostgreSQL без передачи сырых строк в память Node.js.
* **Документация `DB.md`:**
  * Синхронизирован Раздел 14 со спецификацией индексов и новых RPC-функций.

### 1.2 Серверные маршруты Next.js REST API v1
* `app/api/v1/leads/[id]/link-seller/route.ts`:
  * Интегрирован вызов `supabase.rpc('link_lead_to_seller')` с fallback на серверный экшен.
* `app/api/v1/sellers/[id]/link-lead/route.ts`:
  * Интегрирован вызов `supabase.rpc('link_lead_to_seller')` с fallback на серверный экшен.
* `app/api/v1/dashboard/kpi/route.ts`:
  * Заменена выгрузка всех строк в память на вызов RPC `get_dashboard_kpi`.
* `app/api/v1/payouts/calculate/route.ts`:
  * Заменена выгрузка строк на вызов RPC `calculate_payout_accruals`.

### 1.3 Клиентский SDK (`lib/api/client.ts`)
* Реализован модуль In-Memory кэширования `memoryCache = new Map<string, CacheEntry>()` с TTL 30 секунд.
* Поддержка механизма SWR (Stale-While-Revalidate): мгновенный возврат закэшированных данных (0ms задержки) с фоновым обновлением при возрасте записи > 5 секунд.
* Поддержка флага `{ bypassCache: true }` для принудительного обновления.
* Автоматическая инвалидация пространств имен (`invalidateNamespaces`) при всех типах мутаций (leads, sellers, connections, payouts, employees, rates, plans, profile).
* Доступен публичный интерфейс `api.cache` (`invalidate`, `clear`, `get`, `size`).

### 1.4 Фронтенд: Оптимизация рендера `DataJournal.tsx`
* Расширен интерфейс `DataJournalProps` поддержкой `onAssignedChange` и `onContextMenuOpen`.
* Все ключевые коллбэки (`onRowClickStable`, `onStatusChangeStable`, `onAssignedChangeStable`, `onContextMenuOpenStable`, `handleCopy`) обернуты в `useCallback`.
* Для компонента карточки `DataJournalCard` создан кастомный компаратор `areCardPropsEqual`, предотвращающий холостые ре-рендеры всех 50 карточек при открытии контекстного меню или сторонних кликах.
* Изолирован контроллер `useContextMenuController` с вызовом `onContextMenuOpenStable`.

---

## 2. Результаты тестов и верификации

1. **Тест компиляции TypeScript (`npx tsc --noEmit`):**
   * Результат: **Exit Code 0** (0 ошибок типизации).
2. **Next.js Production Build (`npm run build`):**
   * Скомпилировано 43 статических и динамических маршрута.
   * Результат: **Exit Code 0** (успешная сборка).
3. **Автоматизированный проверочный скрипт (`scripts/verify-perf-swr.mjs`):**
   * Блок 1 (Миграция 014, pg_trgm, GIN-индексы, FOR UPDATE, RPC): **PASSED**
   * Блок 2 (Актуализация DB.md): **PASSED**
   * Блок 3 (Вызовы RPC в API роутах): **PASSED**
   * Блок 4 (SWR-кэш и инвалидация): **PASSED**
   * Блок 5 (Мемоизация DataJournal): **PASSED**
   * Результат: **Exit Code 0**.
4. **Сквозное E2E тестирование (`npx tsx scripts/verify-e2e.mjs`):**
   * Все 6 блоков E2E (Rate limiting, Sliding window, Server-Timing, бизнес-инварианты, OpenAPI): **PASSED (Exit Code 0)**.
