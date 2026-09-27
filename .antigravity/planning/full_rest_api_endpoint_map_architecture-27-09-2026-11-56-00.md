# План архитектурного рефакторинга: Перевод SotkaCRM на гранулярную REST API архитектуру (v1), SDK клиент и OpenAPI 3.0.3

**Дата и время формирования плана:** 27-09-2026 11:56:00  
**Статус:** Согласован к исполнению  

---

## 1. Цели и архитектурное обоснование

1. **Устранение дублирования логики Server Actions и создание формализованного API-контракта:**
   - Перевод всех операций CRM с хаотичных Server Actions на RESTful Route Handlers в пространстве `/api/v1/*`.
   - Поддержка стандартизированного формата ответов и ошибок RFC 7807 (`{ error: string, code: string, details?: any }`).
   - Централизация авторизации и ролевого доступа (RBAC) через `requireAuth()`, `requireAdmin()`, `requireRoles()`.

2. **Создание типизированного API SDK (`lib/api/client.ts`):**
   - Инкапсуляция всех HTTP-запросов (`fetch`) с обработкой ошибок, автоматической передачей кук и типизированными DTO.
   - Единый объект `api.*` для всех модулей: `auth`, `dashboard`, `leads`, `sellers`, `connections`, `payouts`, `employees`, `rates`, `plans`, `analytics`, `profile`.

3. **Синхронизация полной спецификации OpenAPI 3.0.3 (`public/openapi.json`):**
   - Полное документирование более чем 40 эндпоинтов, DTO, параметров пагинации/фильтрации и кодов ответов.
   - Доступность в защищенном Swagger UI (`/docs`) для администраторов.

4. **Соблюдение критических инвариантов бизнес-логики (`GEMINI.md`):**
   - Неизменяемость реестра лидов: в `DELETE /api/v1/leads/[id]` физическое удаление (`DELETE`) строго запрещено; производится soft-delete (перевод в `status = 'Отмена'`).
   - Изоляция продавцов для консультантов (`moderation = 'approved'`).
   - Защита административных функций (тарифы, выплаты, сотрудники, синхронизация).

---

## 2. Поэтапный план реализации

### Этап 1: Базовый слой вспомогательных утилит API (`lib/api/handler.ts`)
* Унифицированные ответы `apiSuccess(data, status = 200)` и `apiError(error, code, status, details)`.
* Безопасная обработка исключений и маппинг ошибок Zod и Supabase в соответствующие HTTP-коды (400, 401, 403, 404, 422, 500).

### Этап 2: Реализация Route Handlers (`app/api/v1/`)
* **2.1. Аутентификация (`app/api/v1/auth/`):**
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/auth/me`
* **2.2. Главная панель (`app/api/v1/dashboard/`):**
  - `GET /api/v1/dashboard/kpi`
  - `GET /api/v1/dashboard/funnel`
  - `GET /api/v1/dashboard/activity`
* **2.3. Лиды (`app/api/v1/leads/`):**
  - `GET /api/v1/leads`
  - `POST /api/v1/leads`
  - `GET /api/v1/leads/[id]`
  - `PATCH /api/v1/leads/[id]`
  - `PATCH /api/v1/leads/[id]/status`
  - `PATCH /api/v1/leads/[id]/assigned`
  - `DELETE /api/v1/leads/[id]` (перевод в «Отмена»)
  - `POST /api/v1/leads/[id]/link-seller`
  - `DELETE /api/v1/leads/[id]/link-seller`
  - `GET /api/v1/leads/scripts`
  - `GET /api/v1/leads/[id]/whatsapp`
* **2.4. Продавцы (`app/api/v1/sellers/`):**
  - `GET /api/v1/sellers`
  - `POST /api/v1/sellers`
  - `GET /api/v1/sellers/[id]`
  - `PATCH /api/v1/sellers/[id]`
  - `DELETE /api/v1/sellers/[id]`
  - `GET /api/v1/sellers/available-leads-check`
  - `POST /api/v1/sellers/[id]/link-lead`
  - `POST /api/v1/sellers/sync`
* **2.5. Подключения (`app/api/v1/connections/`):**
  - `GET /api/v1/connections`
  - `POST /api/v1/connections`
  - `PATCH /api/v1/connections/[id]`
  - `DELETE /api/v1/connections/[id]`
  - `POST /api/v1/connections/maintenance/fk`
* **2.6. Выплаты (`app/api/v1/payouts/`):**
  - `GET /api/v1/payouts`
  - `POST /api/v1/payouts/calculate`
  - `PATCH /api/v1/payouts/[id]/status`
  - `PATCH /api/v1/payouts/[id]`
* **2.7. Сотрудники (`app/api/v1/employees/`):**
  - `GET /api/v1/employees`
  - `POST /api/v1/employees`
  - `PATCH /api/v1/employees/[id]`
  - `PATCH /api/v1/employees/[id]/color`
  - `DELETE /api/v1/employees/[id]`
* **2.8. Тарифы (`app/api/v1/rates/`):**
  - `GET /api/v1/rates`
  - `POST /api/v1/rates`
  - `PATCH /api/v1/rates/[id]`
  - `DELETE /api/v1/rates/[id]`
* **2.9. Бизнес-планы (`app/api/v1/plans/`):**
  - `GET /api/v1/plans`
  - `POST /api/v1/plans`
  - `PATCH /api/v1/plans/[id]`
  - `DELETE /api/v1/plans/[id]`
* **2.10. Аналитика (`app/api/v1/analytics/`):**
  - `GET /api/v1/analytics/summary`
  - `GET /api/v1/analytics/funnel`
  - `GET /api/v1/analytics/employees`
  - `POST /api/v1/analytics/export`
* **2.11. Профиль (`app/api/v1/profile/`):**
  - `GET /api/v1/profile`
  - `POST /api/v1/profile/change-password`
  - `PATCH /api/v1/profile/preferences`
  - `GET /api/v1/profile/permissions`

### Этап 3: Создание типизированного API SDK клиента (`lib/api/client.ts`)
* Единый интерфейс взаимодействия `api.<модуль>.<действие>` для использования во всех React-компонентах.

### Этап 4: Рефакторинг UI-компонентов на вызовы API SDK
* Обновление модулей: Лиды (`app/leads/page.tsx`), Продавцы (`app/sellers/page.tsx`), Главная (`app/page.tsx`), Подключения (`app/connections/page.tsx`), Выплаты (`app/payouts/page.tsx`), Сотрудники (`app/employees/page.tsx`), Тарифы (`app/rates/page.tsx`), Планы (`app/plans/page.tsx`), Аналитика (`app/analytics/page.tsx`), Профиль (`app/profile/page.tsx`), Заголовки (`TopHeader.tsx`, `MobileHeader.tsx`).

### Этап 5: Актуализация документации OpenAPI 3.0.3 (`public/openapi.json`)
* Генерация спецификации всех эндпоинтов, схем и ответов.

### Этап 6: Сборка и верификация
* `npx tsc --noEmit`
* `npm run build`
* Создание отчета верификации и фиксация в Git.
