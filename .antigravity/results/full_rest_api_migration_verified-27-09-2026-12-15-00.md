# Отчет о внедрении REST API v1 и миграции UI-компонентов SotkaCRM

**Дата и время завершения:** 27-09-2026 12:15:00  
**Статус верификации:** Успешно (Exit Code 0: `npx tsc --noEmit`, `npm run build`)

---

## 1. Обзор выполненных работ

В соответствии с архитектурным планом завершен полный перевод взаимодействия клиентской части SotkaCRM с базы данных на формализованный слой REST API (`/api/v1/*`), типизированный SDK-клиент (`lib/api/client.ts`) и интерактивную документацию OpenAPI 3.0.3 (`public/openapi.json`).

### 1.1 Реализованные группы эндпоинтов (43 маршрута):

1. **Authentication (`/api/v1/auth/*`):**
   - `POST /api/v1/auth/login`: вход с выдачей JWT и профиля.
   - `POST /api/v1/auth/logout`: завершение пользовательской сессии.
   - `GET /api/v1/auth/me`: проверка активной сессии и прав.

2. **Dashboard (`/api/v1/dashboard/*`):**
   - `GET /api/v1/dashboard/kpi`: оперативные KPI с учетом роли (воронка, продавцы, подключения, выплаты).
   - `GET /api/v1/dashboard/funnel`: конверсионное распределение по стадиям.
   - `GET /api/v1/dashboard/activity`: журнал последних 10 событий воронки.

3. **Leads (`/api/v1/leads/*`):**
   - `GET /api/v1/leads`: реестр лидов с пагинацией, фильтрами, сортировкой и RBAC.
   - `POST /api/v1/leads`: добавление лида (доступно SMM и Admin, закрыто для Consultant).
   - `GET /api/v1/leads/[id]`: получение карточки лида.
   - `PATCH /api/v1/leads/[id]`: редактирование атрибутов лида.
   - `DELETE /api/v1/leads/[id]`: **Инвариант целостности:** soft-delete — перевод в статус `Отмена` с запретом физического удаления `DELETE` (DB-триггер `prevent_lead_delete`).
   - `PATCH /api/v1/leads/[id]/status`: валидированный переход по этапам воронки.
   - `PATCH /api/v1/leads/[id]/assigned`: назначение ответственного консультанта (только Admin).
   - `POST /api/v1/leads/[id]/link-seller`: ручное связывание с продавцом (`seller_phone`), перевод в `Подписан`, создание `connections`.
   - `DELETE /api/v1/leads/[id]/link-seller`: разрыв связки продавца и лида.
   - `GET /api/v1/leads/[id]/whatsapp`: генерация ссылки прямого контакта WhatsApp.
   - `GET /api/v1/leads/scripts`: скрипты продаж для быстрого регламента консультантов.

4. **Sellers (`/api/v1/sellers/*`):**
   - `GET /api/v1/sellers`: реестр продавцов. Роли консультанта доступны только `approved` записи. SMM доступ закрыт (403).
   - `POST /api/v1/sellers`: создание карточки продавца.
   - `GET /api/v1/sellers/[id]`: детальная карточка продавца.
   - `PATCH /api/v1/sellers/[id]`: редактирование продавца; при изменении `manager_id` автоматически обновляются `connections` и ставки.
   - `DELETE /api/v1/sellers/[id]`: удаление продавца.
   - `GET /api/v1/sellers/available-leads-check`: проверка наличия свободных лидов для динамического показа кнопок связывания.
   - `POST /api/v1/sellers/[id]/link-lead`: связывание со свободным лидом со стороны карточки продавца.
   - `POST /api/v1/sellers/sync`: API-синхронизация с `https://api.sotka.kg` (строго роль Admin, сохранение локальных кураторов).

5. **Connections (`/api/v1/connections/*`):**
   - `GET /api/v1/connections`: реестр клиентских подключений и сопровождения.
   - `POST /api/v1/connections`: фиксация подключения.
   - `PATCH /api/v1/connections/[id]`: смена статуса жизненного цикла клиента (`новый`, `подключен`, `сопровождение`, `приостановлен`, `расторгнут`).
   - `DELETE /api/v1/connections/[id]`: удаление записи подключения.
   - `POST /api/v1/connections/maintenance/fk`: запуск ежемесячного биллинга сопровождения.

6. **Payouts (`/api/v1/payouts/*`):**
   - `GET /api/v1/payouts`: реестр финансовых выплат и удержаний сотрудникам.
   - `POST /api/v1/payouts`: создание выплаты/аванса/бонуса/удержания.
   - `POST /api/v1/payouts/calculate`: предиктивный калькулятор вознаграждения консультанта.
   - `PATCH /api/v1/payouts/[id]`: редактирование транзакции.
   - `DELETE /api/v1/payouts/[id]`: удаление транзакции.
   - `PATCH /api/v1/payouts/[id]/status`: утверждение статуса выплаты (`pending`, `paid`, `cancelled`).

7. **Employees (`/api/v1/employees/*`):**
   - `GET /api/v1/employees`: список сотрудников (только Admin).
   - `POST /api/v1/employees`: создание учетной записи с хэшированием пароля.
   - `PATCH /api/v1/employees/[id]`: редактирование ФИО, телефона, роли и активности (`is_active`).
   - `DELETE /api/v1/employees/[id]`: блокировка доступа сотрудника.
   - `PATCH /api/v1/employees/[id]/color`: персональная цветовая дифференциация аватаров/бейджей.

8. **Rates (`/api/v1/rates/*`):**
   - `GET /api/v1/rates`: ставки сотрудников (% за подключение, % за сопровождение).
   - `POST /api/v1/rates`: добавление / обновление ставки на период.
   - `PATCH /api/v1/rates/[id]`: изменение ставки.
   - `DELETE /api/v1/rates/[id]`: удаление периода ставки.

9. **Plans (`/api/v1/plans/*`):**
   - `GET /api/v1/plans`: каталог тарифов.
   - `POST /api/v1/plans`: добавление тарифа.
   - `PATCH /api/v1/plans/[id]`: редактирование тарифа с автоматической фиксацией аудита цен.
   - `DELETE /api/v1/plans/[id]`: удаление тарифа (с проверкой отсутствия привязанных продавцов).

10. **Analytics (`/api/v1/analytics/*`):**
    - `GET /api/v1/analytics/summary`: сквозная аналитика за период.
    - `GET /api/v1/analytics/funnel`: конверсионные метрики воронки.
    - `GET /api/v1/analytics/employees`: продуктивность консультантов и SMM.
    - `POST /api/v1/analytics/export`: экспорт данных в CSV / Excel.

11. **Profile (`/api/v1/profile/*`):**
    - `GET /api/v1/profile`: профиль и KPI текущего пользователя.
    - `POST /api/v1/profile/change-password`: безопасная смена пароля.
    - `PATCH /api/v1/profile/preferences`: сохранение настроек интерфейса.
    - `GET /api/v1/profile/permissions`: матрица прав доступа.

12. **Sync Gateway & Sotka HQ (`/api/sync/sotka`):**
    - `GET /api/sync/sotka`: healthcheck шлюза синхронизации.
    - `POST /api/sync/sotka`: входящий вебхук обновления продавцов Sotka HQ.

---

## 2. Клиентский SDK (`lib/api/client.ts`)

Разработан строго типизированный фасад `api` с автоматическим парсингом ошибок, формированием `query`-параметров и методами для всех сущностей:
- `api.auth.*`
- `api.dashboard.*`
- `api.leads.*`
- `api.sellers.*`
- `api.connections.*`
- `api.payouts.*`
- `api.employees.*`
- `api.rates.*`
- `api.plans.*`
- `api.analytics.*`
- `api.profile.*`

---

## 3. Миграция UI-компонентов

Все ключевые страницы и модальные окна переведены на использование `api.*`:
1. `app/leads/page.tsx` — создание, редактирование, отмена лида, назначение консультанта и смена статусов через `api.leads.*`.
2. `components/leads/LeadSellerMappingModal.tsx` — закрытие сделки и привязка к продавцу через `api.leads.linkSeller`.
3. `app/sellers/page.tsx` — загрузка реестра продавцов через `api.sellers.getAll`, проверка свободных лидов через `api.sellers.checkAvailableLeads`, назначение куратора через `api.sellers.update`.
4. `components/sellers/LinkSellerLeadModal.tsx` — привязка продавца к лиду через `api.sellers.linkLead`.
5. `app/connections/page.tsx` — загрузка реестра через `api.connections.getAll`, смена статуса через `api.connections.update`, ежемесячный биллинг через `api.connections.runMaintenance`.
6. `app/payouts/page.tsx` — реестр через `api.payouts.getAll`, создание выплат через `api.payouts.create`.
7. `app/employees/page.tsx` — загрузка через `api.employees.getAll`, создание через `api.employees.create`, обновление и блокировка через `api.employees.update`, ставки через `api.rates.*`.
8. `app/plans/page.tsx` — загрузка тарифов через `api.plans.getAll`, создание через `api.plans.create`, обновление через `api.plans.update`, удаление через `api.plans.delete`.
9. `app/analytics/page.tsx` — загрузка сводки через `api.analytics.getSummary`.
10. `app/page.tsx` (Dashboard) — загрузка оперативных счетчиков через `api.dashboard.getKpi` и `api.dashboard.getActivity`.
11. `components/layout/AppLayout.tsx` — запуск внешней синхронизации через `api.sellers.syncSotka`.

---

## 4. Спецификация OpenAPI 3.0.3 (`public/openapi.json`)

Файл `public/openapi.json` полностью синхронизирован и включает:
- 43 документированных эндпоинта;
- 13 категорий (Tags);
- Описание параметров пути (path), параметров запроса (query) и тел запросов (requestBody);
- Модели ответов и структуры ошибок в секции `components/schemas`.

---

## 5. Протокол верификации

1. `npx tsc --noEmit`: 
   - Результат: **Exit code 0**. Все типы валидированы, ошибки компиляции отсутствуют.
2. `npm run build`:
   - Результат: **Exit code 0**. Успешная сборка продакшн-бандла Next.js 15.5.25. Все 43 API-маршрута сгенерированы в динамическом режиме.
3. Проверка инвариантов бизнес-логики:
   - Лиды не удаляются физически (`DELETE` вызывает `status = 'Отмена'`).
   - Изоляция продавцов для консультантов строго соблюдена (`moderation = 'approved'`).
   - Доступ роли SMM к базам продавцов, выплат и ставок заблокирован со статусом HTTP 403.
