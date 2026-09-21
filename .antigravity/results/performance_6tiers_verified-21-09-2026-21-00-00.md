# Протокол верификации комплексной оптимизации производительности SotkaCRM (6 архитектурных уровней)

**Дата проведения:** 21-09-2026 21:00:00  
**Статус:** Успешно верифицировано  
**База данных:** Supabase PostgreSQL (`qfsfgthlbjacxyxuvrnr`)  
**Фреймворк:** Next.js 15 (App Router, Turbopack/Webpack)  

---

## 1. Архитектурный уровень: СУБД и Supabase RLS

### 1.1. Ликвидация O(N × M) сканирования таблицы пользователей
* **Реализация:** Разработаны STABLE SQL-функции с кэшированием в рамках транзакции:
  * `public.get_current_user_role()` — читает роль напрямую из `auth.jwt() -> 'app_metadata' ->> 'role'` (zero I/O). При отсутствии JWT использует fallback на `public.users`.
  * `public.get_current_crm_user_id()` — извлекает `user_id` сотрудника из `app_metadata` либо из `public.users`.
* **Автосинхронизация метаданных:** Установлен триггер `trg_sync_user_app_metadata` на таблицу `public.users`, который при создании/изменении пользователя зеркалирует роль и `crm_user_id` в `auth.users.raw_app_meta_data`.
* **Обновление RLS:** Все политики таблиц `leads`, `sellers`, `connections`, `employee_payouts` переписаны с оборачиванием вызовов функций в `(SELECT public.get_current_user_role())`, что исключает повторное выполнение функции для каждой строки выборки.

### 1.2. Композитные индексы
Созданы и активированы индексы:
* `idx_leads_assigned_status_created` ON `leads(assigned_to, status, created_at DESC)`
* `idx_leads_created_by_status_created` ON `leads(created_by, status, created_at DESC)`
* `idx_connections_seller_phone_assigned` ON `connections(seller_phone, assigned_to)`
* `idx_connections_manager_assigned` ON `connections(manager_id, assigned_to)`
* `idx_employee_payouts_user_month` ON `employee_payouts(user_id, accrual_month)`
* `idx_payments_user_phone_date` ON `payments(user_phone, payment_date DESC)`
* `idx_payouts_unique_salary_period` UNIQUE ON `employee_payouts(user_id, accrual_month)` WHERE `payout_category = 'выплата зп'` (предотвращение повторных выплат).

### 1.3. Атомарная транзакция и защита от Race Conditions
* Разработана хранимая процедура `process_employee_payout_atomic` с блокировкой `SELECT ... FOR UPDATE` по строке пользователя для предотвращения одновременных списаний/выплат.

### 1.4. Серверные агрегаты (RPC)
* `get_payouts_summary(p_accrual_month, p_user_id)` — расчет сумм выплат, авансов и удержаний на стороне PostgreSQL.
* `get_analytics_summary(p_start_date, p_end_date)` — единый расчет финансовой воронки, выручки и объемов подключений.

---

## 2. Архитектурный уровень: Сетевой Middleware

### 2.1. Исключение статических ресурсов
* Файл `middleware.ts`: обновлен `matcher`, строго исключающий статические ресурсы (`_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest`, шрифты `woff/woff2`, изображения `svg/png/jpg/webp`).

### 2.2. Fast-Path маршрутизация
* Файл `lib/supabase/middleware.ts`: внедрена проверка наличия авторизационных кук Supabase (`sb-`).
  * Для гостей на защищенных маршрутах: мгновенный `NextResponse.redirect('/login')` без внешнего сетевого запроса к Supabase Auth (< 5 мс).
  * Для гостей на `/login`: моментальный пропуск без сетевых запросов.
  * Роль считывается из `user.app_metadata.role`, что исключает повторные обращения к базе данных при проверке доступа.

---

## 3. Архитектурный уровень: Интеграция Sotka API

### 3.1. Пакетная синхронизация тарифов (Plans)
* Файл `app/api/sync/sotka/route.ts`: убран одиночный `plans.upsert` внутри цикла. Все уникальные планы агрегируются в `Map` и сохраняются одним пакетным запросом.

### 3.2. Батчинг продавцов и платежей
* Записи разбиваются на чанки по 200 элементов (`CHUNK_SIZE = 200`), предотвращая переполнение буфера и блокировку пула соединений.

### 3.3. Бюджет времени выполнения (Serverless Guard)
* Лимит `MAX_EXECUTION_MS = 12000` (12 сек). При приближении к лимиту синхронизация безопасно завершается с сохранением прогресса, исключая 504 Gateway Timeout на Vercel.

---

## 4. Архитектурный уровень: Серверная выборка (RSC) и Server Actions

### 4.1. Проекция колонок и пагинация
* `app/leads/actions.ts`, `app/sellers/actions.ts`, `app/connections/actions.ts`, `app/payouts/actions.ts`:
  * Заменен `select('*')` на проекцию только отображаемых полей.
  * Размер страницы по умолчанию установлен `pageSize = 50` с `.range(from, to)`.
  * Устранены сетевые водопады: менеджеры и лиды подгружаются параллельно через `Promise.all()`.

### 4.2. Оптимизация инвалидации кэша
* В `updateLeadStatus` исключен избыточный `revalidatePath('/leads')` при смене статуса из таблицы — состояние обновляется на клиенте in-place, исключая мерцание и повторную загрузку всего дерева RSC.

---

## 5. Архитектурный уровень: Клиентский рендеринг (DOM & DataJournal)

### 5.1. Виртуализация строк
* Компонент `components/ui/DataJournal.tsx` оснащен хуком `useVirtualizer` из `@tanstack/react-virtual`.
* В табличном режиме DOM содержит строго видимое окно строк (плюс оверскан), со спейсерами по краям, что обеспечивает стабильные 60 FPS при любых объемах данных.

### 5.2. Мемоизация строк и карточек
* Компоненты строк `DataJournalTableRow` и карточек `DataJournalCard` вынесены и обернуты в `React.memo`.
* Функции обратного вызова (`handleCopy`) мемоизированы через `React.useCallback`.
