# План оптимизации производительности платформы SotkaCRM (6 уровней)

Данный документ фиксирует технический план устранения узких мест производительности платформы SotkaCRM на 6 системных уровнях в соответствии с регламентами `GEMINI.md` и `DB.md`.

---

## 1. Архитектурный анализ и текущее состояние

| Уровень | Текущее состояние | Выявленное узкое место | Целевое решение |
| :--- | :--- | :--- | :--- |
| **1. СУБД & RLS** | Функции `get_current_user_role()` и RLS-политики обращаются к таблице `users` при каждой проверке; нет композитных индексов; агрегаты считаются в Node.js; отсутствуют блокировки выплат. | $O(N \times M)$ чтений в RLS; Seq Scan / Bitmap Scan при фильтрации; задержка CPU Node.js; риск race conditions при начислении выплат. | 1. Мемоизация роли через JWT `app_metadata` с fallback на `users` (`STABLE SECURITY DEFINER`).<br>2. Оборачивание `(SELECT public.get_current_user_role())` в политиках.<br>3. Композитные индексы `idx_leads_assigned_status_created`, `idx_connections_seller_created`, `idx_employee_payouts_user_month`.<br>4. RPC-функции `get_payouts_summary` и `get_analytics_summary`.<br>5. Транзакционная функция выплат с `SELECT ... FOR UPDATE` и ограничением дубликатов. |
| **2. Серверная выборка (RSC)** | `pageSize = 1000` по умолчанию в `getLeads`, `getConnections`, `getSellers`; использование wildcard `select('*')`. | Раздувание RSC payload (до 500 КБ+ на страницу), блокировка гидратации, медленный TTFB на мобильных устройствах. | Ограничение `pageSize = 50` с серверной пагинацией (`range(from, to)`); точечная проекция полей для журналов, вторичные данные — по запросу в `EntityModal`. |
| **3. Server Actions** | Последовательные `await` вызовы (`getUser()` -> `users.select()` -> валидация FK -> мутация); вызовы `revalidatePath` при одиночных апдейтах. | Задержки до 400–700 мс на мутацию; сброс кэша всего маршрута и полная пересборка дерева RSC. | Параллелизация независимых запросов через `Promise.all()`; опора на FK и RLS СУБД; возврат обновленной сущности без избыточного `revalidatePath`. |
| **4. Интеграция Sotka API** | Синхронизация транзакций и продавцов с единичными `upsert` планов внутри цикла и постраничным перебором до 100+ страниц без тайм-бюджета. | Риск Serverless Timeout (Vercel 10–15 сек); N+1 запросы на регистрацию тарифов. | Батчинг порциями по 200 записей (`CHUNK_SIZE = 200`); предварительная агрегация и пакетный upsert тарифов; инкрементальная фиксация `last_synced_at` и guard по времени. |
| **5. Middleware** | `supabase.auth.getUser()` выполняется на каждый запрос к любому ресурсу, даже без авторизационных кук. | +150–250 мс задержки на каждый переход и статический запрос из-за внешнего сетевого HTTP-вызова. | Строгий `matcher` для исключения статики, манифестов и шрифтов; быстрая проверка наличия куки сессии до сетевого запроса к Auth API. |
| **6. Клиентский DOM** | `DataJournal.tsx` рендерит плоский массив строк в DOM без виртуализации; строки таблицы пересчитываются при любых изменениях стейта. | Просадка FPS до 10–15 при скролле; задержка ввода (Input Latency) при поиске и фильтрации. | Интеграция `@tanstack/react-virtual` для виртуализации строк таблицы и карточек; мемоизация `DataJournalRow` через `React.memo`. |

---

## 2. Предлагаемые изменения по компонентам

### СУБД и миграции Supabase

#### [NEW] `supabase/migrations/009_performance_and_isolation_optimization.sql`
1. **Мемоизация контекста пользователя в RLS:**
   - Проверка роли сначала из JWT app_metadata, затем из таблицы `users` с мемоизацией `STABLE SECURITY DEFINER`.
   - Проверка ID пользователя CRM сначала из JWT app_metadata, затем из `users`.
2. **Синхронизация роли в `raw_app_meta_data` пользователей при создании/обновлении:**
   - Триггер `trg_sync_user_role_to_auth` на `public.users` для автоматической записи роли и user_id в `auth.users.raw_app_meta_data`.
3. **Обновление RLS политик на `leads`, `sellers`, `connections`, `employee_payouts`:**
   - Замена всех прямых вызовов на скалярные подзапросы: `(SELECT public.get_current_user_role())` и `(SELECT public.get_current_crm_user_id())`.
4. **Композитные индексы:**
   - `idx_leads_assigned_status_created` на `public.leads (assigned_to, status, created_at DESC)`
   - `idx_leads_created_by_status_created` на `public.leads (created_by, status, created_at DESC)`
   - `idx_connections_seller_phone_assigned` на `public.connections (seller_phone, assigned_at DESC)`
   - `idx_connections_manager_assigned` на `public.connections (manager_id, assigned_at DESC)`
   - `idx_employee_payouts_user_month` на `public.employee_payouts (user_id, accrual_month, payout_date DESC)`
   - `idx_payments_user_phone_date` на `public.payments (user_phone, date_time DESC)`
5. **Агрегирующие RPC-функции:**
   - `get_payouts_summary(p_accrual_month text DEFAULT NULL, p_user_id uuid DEFAULT NULL)` — расчет `totalPaid`, `totalAdvances`, `totalDeductions`, `transactionsCount` на стороне PostgreSQL через `FILTER (WHERE ...)`.
   - `get_analytics_summary(p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL)` — агрегированная сводка воронки и выручки.
6. **Транзакционная фиксация выплат с блокировкой строк:**
   - Ограничение от повторного начисления зарплаты за один расчетный месяц: `idx_payouts_unique_salary_period`.
   - Процедура `create_employee_payout_atomic(...)` с блокировкой `SELECT ... FOR UPDATE` по строке сотрудника в `users`.

#### [MODIFY] `DB.md`
- Актуализация спецификации: добавление описания композитных индексов, оптимизированных RPC-функций и правил мемоизации RLS.

---

### Серверный слой данных и Server Actions

#### [MODIFY] `app/leads/actions.ts`
- Внедрение строгой пагинации: замена `pageSize = 1000` на `pageSize = 50` с диапазоном `.range(from, to)`.
- Точечная проекция полей: исключение избыточных данных из общего списка журнала.
- Параллелизация проверок в `updateLead` / `createLead` через `Promise.all()`.
- Устранение избыточных вызовов `revalidatePath('/leads')` при атомарной смене статуса или ответственного: возврат мутированной сущности для мгновенного локального обновления.

#### [MODIFY] `app/connections/actions.ts`
- Пагинация `pageSize = 50` с `.range(from, to)`.
- Замена wildcard `select('*')` на перечень отображаемых в таблице колонок.
- Оптимизация параллельных проверок.

#### [MODIFY] `app/sellers/actions.ts`
- Пагинация `pageSize = 50` с `.range(from, to)`.
- Выборка только столбцов, отображаемых в таблице и мобильной карточке продавца.
- Параллелизация получения связанных менеджеров и лидов.

#### [MODIFY] `app/payouts/actions.ts`
- Перевод функции `getPayoutsStats()` на прямой вызов RPC `get_payouts_summary` вместо выгрузки всех записей и цикла `.reduce()` в Node.js.
- Интеграция транзакционного метода `create_employee_payout_atomic` для защиты от race conditions.

---

### Модуль интеграции и синхронизации (Sotka API)

#### [MODIFY] `app/api/sync/sotka/route.ts`
- Исключение одиночных запросов `plans.upsert` из цикла: сбор всех уникальных новых планов в батче и однократный пакетный upsert.
- Батчинг сохранения продавцов и платежей порциями по 200 записей (`CHUNK_SIZE = 200`).
- Внедрение контроля времени выполнения (Serverless Execution Budget, лимит 12 секунд): безопасное завершение с сохранением прогресса при приближении к таймауту платформы Vercel.
- Запись времени последней синхронизации `last_synced_at`.

---

### Middleware и маршрутизация Next.js

#### [MODIFY] `middleware.ts`
- Актуализация `matcher`: строгое исключение `_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest`, шрифтов (`woff`, `woff2`), векторных и растровых изображений (`svg`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `ico`).

#### [MODIFY] `lib/supabase/middleware.ts`
- Реализация Fast-Path проверки:
  - Инспекция кук `request.cookies` на наличие авторизационных токенов Supabase (префикс `sb-`).
  - При отсутствии кук сессии:
    - Если путь защищен (не `/login` и не `/api/*`) — мгновенный `NextResponse.redirect(new URL('/login', request.url))` без сетевого обращения к Supabase Auth.
    - Если путь `/login` — моментальный возврат `NextResponse.next()` без сетевого обращения.
  - Сетевой вызов `supabase.auth.getUser()` выполняется строго при наличии аутентификационных токенов в куках.

---

### Клиентский рендеринг и оптимизация DOM

#### [MODIFY] `package.json`
- Добавление зависимости `@tanstack/react-virtual`.

#### [MODIFY] `components/ui/DataJournal.tsx`
- Подключение `useVirtualizer` для контейнера строк таблицы (`table > tbody`) и карточного контейнера (`Card View`).
- Рендеринг только видимого окна записей со смещением `transform: translateY(...)`.
- Вынесение строки таблицы в мемоизированный компонент `DataJournalRow` с `React.memo` и компаратором изменений по ID и версии записи.
- Оптимизация `useMemo` для фильтрации и сортировки.

---

## 3. План верификации

### Автоматизированное тестирование
1. **Проверка схемы БД и миграций:**
   - Выполнение SQL-скрипта миграции в Supabase через `execute_sql`.
   - Проверка наличия индексов и функций в каталоге `information_schema` и `pg_indexes`.
   - Валидация работы RPC `get_payouts_summary` и `get_current_user_role()`.
2. **Проверка типов TypeScript:**
   - `npx tsc --noEmit` — 0 ошибок.
3. **Сборка проекта:**
   - `npm run build` — успешная компиляция всех 16 маршрутов.

### Ручная валидация и профилирование
1. **Сетевой Middleware:**
   - Проверка запросов без кук: мгновенный редирект на `/login` с задержкой < 10 мс (без внешних сетевых вызовов к Auth API).
   - Проверка статических ассетов и манифеста: middleware пропускает их без вызова `updateSession`.
2. **Скорость отрисовки DataJournal:**
   - Проверка плавности скролла (60 FPS) и мгновенного отклика поисковой строки при 500+ записях.
3. **Синхронизация Sotka API:**
   - Проверка батчевой вставки по 200 записей и корректности регистрации тарифов.
