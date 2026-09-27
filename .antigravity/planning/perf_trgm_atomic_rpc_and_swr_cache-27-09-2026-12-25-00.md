# План реализации: Оптимизация производительности (Trigram GIN, Атомарный RPC, SWR Кэш, DataJournal Memoization)

**Дата:** 27-09-2026 12:25:00  
**Статус:** В работе  
**Соответствие спецификациям:** `GEMINI.md`, `DB.md`, `ТЗ.md`, `UxUi.md`

---

## 1. Цели и задачи этапа

1. **База данных Supabase (PostgreSQL 15+):**
   - Создание миграции `supabase/migrations/014_trgm_search_and_atomic_linking.sql`:
     - Активация расширения `pg_trgm`.
     - Создание GIN-триграммных индексов для быстрого поиска `ILIKE` по `leads` (`client_name`, `phone`, `comment`) и `sellers` (`seller_name`, `seller_phone`, `store`), а также составных поисковых выражений.
     - Разработка хранимой процедуры `link_lead_to_seller(p_lead_id, p_seller_phone, p_user_id, p_manager_id, p_assigned_by)` с блокировкой строк `FOR UPDATE` (исключение race condition и рассинхронизации).
     - Разработка хранимой процедуры `get_dashboard_kpi(p_user_id, p_role, p_month)` для вычисления всех счетчиков дашборда за 1 сетевой раундтрип.
     - Разработка хранимой процедуры `calculate_payout_accruals(p_accrual_month, p_employee_id)` для мгновенного суммирования бонусов за подключение и сопровождение.
   - Актуализация `DB.md` (добавление миграции 014, описание индексов и RPC-функций).

2. **Бэкенд-маршруты (Next.js REST API v1):**
   - `app/api/v1/leads/[id]/link-seller/route.ts`: переход на прямой вызов RPC `link_lead_to_seller`.
   - `app/api/v1/sellers/[id]/link-lead/route.ts`: переход на прямой вызов RPC `link_lead_to_seller`.
   - `app/api/v1/dashboard/kpi/route.ts`: замена выгрузки сырых строк на вызов RPC `get_dashboard_kpi` с fallback-агрегацией.
   - `app/api/v1/payouts/calculate/route.ts`: замена выгрузки записей в память на RPC `calculate_payout_accruals`.

3. **Клиентский SDK (`lib/api/client.ts`):**
   - Реализация in-memory кэша для GET-запросов (`Map<string, { data: any, timestamp: number }>`) со временем жизни (TTL) 30 секунд.
   - Механизм SWR (Stale-While-Revalidate): мгновенный возврат закэшированных данных (0ms задержки) с фоновым обновлением.
   - Поддержка параметра обхода кэша `{ bypassCache: true }`.
   - Автоматическая инвалидация пространств имен кэша при мутациях (`POST`, `PATCH`, `DELETE`, `link*`, `sync*`).
   - Публичный API управления кэшем (`api.cache.invalidate`, `api.cache.clear`, `api.cache.size`).

4. **Фронтенд-оптимизация (`components/ui/DataJournal.tsx`):**
   - Расширение типизации `DataJournalProps` поддержкой `onAssignedChange` и `onContextMenuOpen`.
   - Стабилизация коллбэков строк (`onRowClick`, `onStatusChange`, `onAssignedChange`, `onContextMenuOpen`, `handleCopy`) через `useCallback`.
   - Добавление кастомного компаратора `areCardPropsEqual` для `DataJournalCard` аналогично табличной строке `DataJournalRow`.
   - Полная изоляция контекстного меню ПКМ через портал и событийно-ориентированный контроллер без рендера всей таблицы строк.

---

## 2. Пошаговый план внедрения

| Шаг | Компонент | Файлы | Действие |
|---|---|---|---|
| 1 | DB Migration | `supabase/migrations/014_trgm_search_and_atomic_linking.sql` | Создание DDL миграции (pg_trgm, GIN-индексы, RPC) |
| 2 | Документация | `DB.md` | Добавление описания миграции 014, индексов и функций |
| 3 | Backend Routes | `app/api/v1/leads/[id]/link-seller/route.ts`, `app/api/v1/sellers/[id]/link-lead/route.ts`, `app/api/v1/dashboard/kpi/route.ts`, `app/api/v1/payouts/calculate/route.ts` | Интеграция RPC в роуты API |
| 4 | Client SDK | `lib/api/client.ts` | Реализация SWR кэша и инвалидации |
| 5 | UI | `components/ui/DataJournal.tsx` | Мемоизация карточек, коллбэков и изоляция контекстного меню |
| 6 | Верификация | `scripts/verify-e2e.mjs`, `npm run build` | Запуск тестов, компиляция и проверка целостности |
| 7 | Отчет | `.antigravity/results/perf_trgm_atomic_rpc_and_swr_cache_verified-27-09-2026-12-xx-xx.md` | Формирование отчета результатов |
