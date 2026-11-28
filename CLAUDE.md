# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SotkaCRM — CRM для привлечения продавцов на платформу Sotka (Кыргызстан): лиды → продавцы → подключения → начисления и выплаты сотрудникам. Next.js 15 (App Router) + React 19 + Tailwind, база — Supabase Postgres с RLS, деплой на Vercel из `main` (регион `sin1`). Весь интерфейс, сообщения об ошибках, комментарии и документация — на русском.

## Команды

```bash
npm run dev                 # разработка, http://localhost:3000 (API-документация — /docs)
npm run build               # продакшен-сборка, она же проверка сборки перед PR
npx tsc --noEmit            # проверка типов (быстрее сборки)
node scripts/build-openapi.js   # пересобрать public/openapi.json по маршрутам app/api
```

Тестового фреймворка нет. Проверки — самостоятельные скрипты в `scripts/verify-*.mjs`, падают с ненулевым кодом. Один «тест» = один скрипт:

```bash
node --experimental-strip-types scripts/verify-lead-status-rules.mjs
for s in lead-status-rules phone-format sotka-normalizers connection-order payroll-calc perf-swr kanban-order sales-scripts changelog onboarding-tours lead-funnel; do
  node --experimental-strip-types "scripts/verify-$s.mjs" || echo "FAIL $s"
done
```

Флаг `--experimental-strip-types` нужен: скрипты импортируют `.ts`-модули из `lib/`, поэтому относительные импорты внутри таких модулей пишутся с расширением `.ts`. Часть скриптов проверяет код текстом (наличие вызовов, токенов в миграциях) — при переименовании функций обновляйте и их.

Без базы и сети работают одиннадцать скриптов из цикла выше. `verify-billing-payroll` ходит в живую базу (ключи Supabase в `.env.local`). `verify-e2e`, `verify-wallet-bulk-isolation` и `verify-payouts-isolation` сейчас не запускаются: первые два импортируют модули с алиасом `@/` и `next/server`, которые Node без сборщика не разрешает, третий проверяет разметку старой нижней панели.

ESLint не настроен: `npm run lint` запросит интерактивную настройку.

## Архитектура

### Слои запроса

- **Страницы** `app/<модуль>/page.tsx` — клиентские компоненты. Данные берут через `lib/api/client.ts` (`api.<модуль>.<метод>`): GET кэшируются в памяти на 30 с, мутации сбрасывают кэш через `invalidateNamespaces(...)`. Добавляя мутацию, перечисляйте все затронутые пространства (`leads`, `sellers`, `connections`, `payouts`, `dashboard`…).
- **REST API** `app/api/v1/**/route.ts`. Типовой обработчик: `requirePermission('<модуль>.<действие>')` → валидация zod → вызов сервиса → `apiSuccess` / `apiError` / `handleApiError` из `lib/api/handler.ts`. Часть операций дублируется серверными действиями в `app/<модуль>/actions.ts`.
- **Сервисы** `lib/services/*` — бизнес-логика, общая для маршрутов и серверных действий. Пишут сервисным клиентом `createAdminClient()` (`lib/supabase/admin.ts`) уже после проверки прав в коде; RLS остается страховкой для прямых запросов. Многие RPC в базе выданы только `service_role`.
- Идентификаторы в zod проверяйте `PG_UUID_REGEX` из `@/lib/validations`, а не `.uuid()`: у части учетных записей UUID не по RFC.

### Права (RBAC)

- Каталог прав — `lib/auth/permissions-catalog.ts` (ключи `модуль.действие`, наборы ролей по умолчанию). Роли и права лежат в таблицах `roles` / `role_permissions`; роль с `is_admin` имеет все права.
- Сервер: `requireAuth()` / `requirePermission()` из `lib/auth/check-role.ts` возвращают контекст с `ctx.can(key)` и `ctx.canViewAll(module)`. Без `<модуль>.view_all` сотрудник видит только свои записи (созданные им, назначенные ему, где он участник подключения).
- Клиент: `useUser().can(key)` из `components/auth/AuthProvider`.
- Новое право: добавить в каталог и в наборы ролей, проверить на сервере и в интерфейсе.

### Предметная модель

- **Лиды** — воронка `Открыт → Нет ответа → Обработан → Назначен → Встреча → Подписан`, сбоку `Перезвонить` и `Отмена` (порядок — `LEAD_STATUSES`). Все правила переходов — в `lib/leads/status-rules.ts` (используются и API, и UI). «Подписан» ставится только привязкой к продавцу; пока лид привязан, статус меняется только отвязкой; «Отмена» требует причину из списка (`lib/leads/cancel-reasons.ts`), «Встреча» — `meeting_at`, «Перезвонить» — `next_contact_at` (проверяют `buildStatusChange` и триггеры БД). Счетчики по статусам и «На сегодня» — `lib/leads/stats.ts`, дубли номера — `lib/leads/duplicates.ts` и `GET /api/v1/leads/duplicates` (предупреждение, не запрет). Новый статус — это значение enum `lead_status` (отдельная миграция: значение нельзя использовать в той же транзакции), право `leads.status.<статус>`, `LEAD_STAGE_ORDER` / боковые статусы, цвет в `PIPELINE_STATUS_OPTIONS` и счетчик в `STATUS_COUNT_KEY`.
- **Продавцы** синхронизируются из Sotka HQ API (`lib/services/sotka-api.ts`, `app/api/sync/sotka`, контракт — `sotka-api.json`). Ключ продавца — `seller_phone`. API Sotka вызывается только с сервера: маршрут синхронизации принимает `Bearer CRON_SECRET` (Vercel Cron) или сессию с правом `sellers.sync`. Upsert продавцов не передает `manager_id`: консультант — локальное назначение CRM и при синхронизации не затирается.
- **Подключения** (`connections`) — закрепление продавца за сотрудниками. `manager_id` — основной участник (он же консультант продавца), остальные — в `connection_participants`, всего до трех; бонус делится поровну. Сопровождение по месяцам — `connection_maintenance_assignments` (по умолчанию все участники). Статус подтверждения `pending | confirmed | rejected`: начисление за подключение создает триггер БД при подтверждении, сопровождение начисляется только при запуске биллинга. Вся логика — `lib/services/connections.ts` (`createSellerConnection`, `assignConnectionStaff`, `assignSellerToManager`, `setConnectionConfirmation`, `deleteConnection`).
- **Привязка лида** — `lib/services/lead-linking.ts`: связь через `leads.seller_phone = sellers.seller_phone`, один продавец — не более одного лида (в списке для привязки нет продавцов, чей телефон уже стоит у лида). SQL-функция `link_lead_to_seller` меняет только лид (продавец, «Подписан», `linked_at`, ответственный); свободному продавцу подключение создается через `createSellerConnection`, у подключенного лид лишь прикрепляется. Отвязка снимает ожидающее подключение и оставляет подтвержденное.
- **Скрипты продаж** — каталог `lib/sales/scripts.ts` (разделы в порядке диалога, подстановки `{имя}` / `{менеджер}`, `fillScript`), тарифы платформы — `lib/sales/tariffs.ts`: тексты о ценах строятся из него, цены меняются только там. Кнопка WhatsApp у лида при праве `leads.scripts` открывает `components/leads/WhatsAppScriptModal.tsx` (свойство `onWhatsApp` у `DataJournal` и `EntityModal`), без права — прямую ссылку wa.me.
- **Комментарии лида** — лента `lead_comments` (миграция 048, `lib/services/lead-comments.ts`, `GET/POST /api/v1/leads/[id]/comments`): автор, время, текст, без правки и удаления. Триггер делает новый комментарий «последним» в `leads.comment` — его показывают реестр и карточка; в форме лида комментарий не правится, только добавляется через окно `components/leads/LeadCommentsModal.tsx`. Права — `canEditLeadComment` (`leads.comment` или `leads.edit` и лид в области видимости).
- **Начисления и выплаты** — двойной реестр: `connection_accruals` (по подключениям) синхронизируется триггерами с журналом ЗП `employee_payouts`. Порядок месяцев начисления — `lib/payroll/connection-order.ts`.

### Telegram

Уведомления ставятся в очередь `telegram_outbox`: из триггеров БД (функция `telegram_enqueue`, учитывает привязку чата и настройки сотрудника) и с сервера (`lib/services/connection-notifications.ts`). Отправка — `scheduleTelegramDispatch()` из `lib/telegram/outbox.ts` после мутации, плюс маршрут `app/api/telegram/dispatch`. Запрос на подтверждение подключения содержит одноразовую ссылку `/api/telegram/confirm/[token]` (GET — страница с кнопкой, POST — подтверждение; доступна без входа).

### Интерфейс

- Все таблицы модулей — `components/ui/DataJournal.tsx` (таблица/карточки, вкладки-фильтры, колонки, массовые действия). Вид «Канбан» включается свойством `kanban` (`KanbanConfig` из `components/ui/KanbanBoard.tsx`, перетаскивание — `@dnd-kit/core`): модуль задает раскладки колонок, `canMove` (true или причина запрета) и `onMove`; правила переноса должны совпадать с серверными. Порядок колонок пользователь меняет сам (`@dnd-kit/sortable`), он хранится только в `localStorage` (`lib/utils/kanban-order.ts`). Действия строки задаются через `customRowActions` элементами `JournalMenuItem` и показываются в контекстном меню (ПКМ / «⋯»), в карточках — значками.
- Обучение по модулям — туры `lib/onboarding/tours.ts`: шаг подсвечивает элемент с атрибутом `data-tour="…"` (метки в `DataJournal`, оболочке и страницах), шаги фильтруются правами роли. Движок — `components/onboarding/GuideProvider.tsx` (в `AppShell`) и `TourOverlay.tsx`, прогресс — `onboarding_progress` (миграция 049, `/api/v1/onboarding`), отчет администратора — вкладка «Обучение» в «Сотрудниках» (право `employees.training`). Переименовывая или убирая элемент с `data-tour`, обновите тур (`verify-onboarding-tours` проверяет, что метки есть в разметке); новую кнопку модуля, о которой стоит рассказать, добавьте в его тур.
- Окна — `components/ui/Modal.tsx` (`Modal`, `ModalCallout`) и `ConfirmDialog.tsx`, поля и кнопки — `Field.tsx`, `Button.tsx`. Не используйте `window.confirm`.
- Постоянная оболочка `components/layout/AppShell.tsx` монтируется один раз в `app/layout.tsx`; страница регистрирует свою конфигурацию через `AppLayout`.
- Описания модулей не выводятся на страницах — они в справке «?» (`lib/module-help.ts`); меняя поведение модуля, обновляйте его подсказки.
- Даты — `lib/utils/format.ts` («ДД.ММ.ГГГГ - чч:мм:сс», «ММ.ГГГГ», часовой пояс Бишкека), телефоны — `lib/utils/phone.ts` (`formatPhoneDisplay`, коды стран СНГ).
- Стиль — `UxUi.md` (Apple Island: матовые «островки» `rounded-2xl` / `rounded-3xl`, `backdrop-blur-xl`). Иконки — только контурные Lucide (`strokeWidth` 1.75 или 2). Emoji запрещены во всех элементах интерфейса, включая статусы и уведомления.
- `'use client'` — только у компонентов с интерактивностью. Серверные ключи (`SUPABASE_SERVICE_ROLE_KEY`, `SOTKA_API_PASSWORD`, `TELEGRAM_BOT_TOKEN`) используются только в маршрутах, серверных действиях и `lib/services`.

## Версии

Версия приложения — первая запись `lib/changelog.ts` (`APP_VERSION`); `package.json` и корневые `version` в `package-lock.json` совпадают с ней, OpenAPI берет ее из `package.json`. Каждое изменение, которое уходит в `main`, без отдельной просьбы:

- добавляет запись сверху (или дополняет текущую, если она еще не выпущена): MINOR — новые возможности, PATCH — только исправления; дата «ГГГГ-ММ-ДД»;
- пишет пункты «Добавлено / Изменено / Исправлено» для сотрудников — что изменилось в работе, без технических подробностей и emoji;
- поднимает версию в `package.json` и `package-lock.json` (`verify-changelog` проверяет совпадение и порядок).

Пользователь видит журнал в окне «Что нового» (значок версии в меню, справка «?»); после обновления окно открывается само один раз.

## База данных и миграции

- Миграции — `supabase/migrations/NNN_описание.sql`, нумерация сквозная. Пишите их идемпотентными (`CREATE OR REPLACE`, `IF NOT EXISTS`, DO-блоки) и в конце вызывайте `NOTIFY pgrst, 'reload schema'`.
- Каждая миграция описывается новым разделом в конце `DB.md` — это актуальная спецификация схемы, функций, триггеров и RLS. README в части списка миграций и поведения отстает от кода.
- `types/database.types.ts` правится вручную: добавляйте новые таблицы и колонки, иначе `tsc` не пропустит запросы к ним.
- Применяется к продакшен-базе Supabase (SQL Editor или MCP). Через Supabase MCP операторы со словами `DROP`, `DELETE`, `TRUNCATE` (в том числе внутри тел функций и в `ON DELETE CASCADE`) ждут ручного подтверждения и зависают: такие части выносите в отдельный шаг или отдавайте выполнить вручную.

## Переменные окружения

Шаблон — `.env.example`, значения хранятся в Vercel. `NEXT_PUBLIC_APP_URL` — адрес в ссылках из Telegram; `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — лимиты запросов в `lib/api/rate-limit.ts` (без них — лимит в памяти процесса).

## Документация обновляется вместе с кодом

Без отдельной просьбы, в том же изменении:

- схема БД (колонка, индекс, триггер, функция, RLS) — раздел в `DB.md`;
- маршруты, пагинация или маппинг полей Sotka HQ API — `sotka-api.json`;
- новый экран, структура карточек, фильтры `DataJournal`, дизайн-токены — `UxUi.md`;
- новая переменная окружения или внешний сервис — плейсхолдер в `.env.example`;
- поведение модуля — подсказки в `lib/module-help.ts` и шаги его тура в `lib/onboarding/tours.ts`;
- любое изменение для пользователей — запись в `lib/changelog.ts` и версия в `package.json` (раздел «Версии»).

`ТЗ.md` — техническое задание и бизнес-процессы. `GEMINI.md` и `.antigravity/` — регламент и архив планов другого ассистента. Часть `GEMINI.md` устарела: роли теперь задаются таблицами `roles` / `role_permissions`, а не `users.role`, и администратор может окончательно удалять лиды (право `leads.delete`).
