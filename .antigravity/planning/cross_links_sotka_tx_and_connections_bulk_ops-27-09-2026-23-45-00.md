# План реализации: Двусторонняя навигация Лид-Продавец, мягкое удаление при синхронизации, транзакции Sotka HQ, массовые действия в Подключениях, фикс видимости ЗП для Admin и компактные карточки проводок

**Дата:** 27-09-2026  
**Ветка:** `main`

---

## 1. Архитектурный план и задачи

### 1.1. База данных и миграция `022_cross_links_soft_delete_and_payouts_admin_fix.sql`
1. Добавить колонку `is_deleted_from_source BOOLEAN NOT NULL DEFAULT false` в таблицу `sellers` с индексом.
2. Создать RPC `unlink_lead_and_seller(p_lead_id UUID)`:
   - Обнуляет `seller_phone = NULL` (и `seller_id = NULL`), статус переводит в `'Назначен'`.
   - Обнуляет `manager_id = NULL` у продавца.
3. Создать RPC `accrue_selected_connections(p_connection_ids UUID[], p_mode VARCHAR, p_settlement_month VARCHAR)`:
   - Начисляет бонусы только по выбранному массиву `connection_ids`.
4. Обновить RLS-политику `employee_payouts_select_policy`:
   - Администраторы и руководители (`role IN ('admin', 'supervisor')`) видят все проводки без ограничений.

### 1.2. Бэкенд и API
1. **Отвязка Лида и Продавца**:
   - `DELETE /api/v1/leads/[id]/unlink-seller`: вызов `unlink_lead_and_seller`.
   - `DELETE /api/v1/sellers/[id]/unlink-lead`: находит лид продавца и выполняет отвязку.
2. **Транзакции продавца из Sotka HQ**:
   - `GET /api/v1/sellers/[id]/transactions`: проксирует запрос к `https://api.sotka.kg/api/private/v1/admin/sellers-overview/${organization_id}/`, возвращает `detail.transactions`.
3. **Синхронизация продавцов (`POST /api/v1/sellers/sync`)**:
   - Отслеживание продавцов, отсутствующих в Sotka API: установка `is_deleted_from_source = true`. Для присутствующих — `is_deleted_from_source = false`.
   - Полное физическое удаление в `DELETE /api/v1/sellers/[id]`.
4. **Массовые действия над подключениями (`POST /api/v1/connections/batch`)**:
   - Действие `update_maintenance_months`: массовое обновление срока сопровождения.
   - Действие `accrue_selected`: выборочный биллинг по массиву ID.
5. **Фикс видимости всех проводок для Admin в `GET /api/v1/payouts`**:
   - Если `role === 'admin'`, не накладывать фильтрацию по сотруднику по умолчанию.

### 1.3. Клиентский SDK и валидации
- Добавить методы в `lib/api/client.ts`:
  - `api.leads.unlinkSeller(id)`
  - `api.sellers.unlinkLead(id)`
  - `api.sellers.getTransactions(id)`
  - `api.connections.batch(data)`
- Обновить OpenAPI-спецификацию (`node scripts/build-openapi.js`).

### 1.4. Фронтенд (UI/UX)
1. **Лиды (`app/leads/page.tsx`)**:
   - В модалке просмотра лида: бейдж/ссылка на привязанного продавца + кнопка «Отвязать продавца» (с подтверждением).
2. **Продавцы (`app/sellers/page.tsx`)**:
   - В модалке просмотра: плашка «Привлечен через лид: [Имя/Телефон]» + переход к лиду + кнопка «Отвязать лид».
   - Вкладка «Транзакции Sotka HQ» со сводкой и таблицей транзакций.
   - Бейдж «Удален в Sotka HQ» в реестре продавцов и кнопка полного удаления для Admin.
3. **Подключения (`app/connections/page.tsx`)**:
   - Чекбоксы мультиселекта строк для Admin.
   - Плавающий Bulk Bar: «Изменить срок сопровождения», «Начислить выбранным».
   - Строгий вывод бонусов: строго `0 с`, если нет реальной проводки `+` в ЗП.
   - Удаление старого громоздкого заголовка начислений в детальной карточке.
4. **Секция проводок (`ConnectionAccrualsSection.tsx`)**:
   - Рендер компактных аккуратных карточек вместо громоздких таблиц/графиков.

---

## 2. Порядок выполнения

1. Создать миграцию `022_cross_links_soft_delete_and_payouts_admin_fix.sql`.
2. Реализовать серверные роуты:
   - `app/api/v1/leads/[id]/unlink-seller/route.ts`
   - `app/api/v1/sellers/[id]/unlink-lead/route.ts`
   - `app/api/v1/sellers/[id]/transactions/route.ts`
   - `app/api/v1/connections/batch/route.ts`
3. Обновить существующие API:
   - `app/api/v1/sellers/sync/route.ts` & `app/sellers/actions.ts`
   - `app/api/v1/payouts/route.ts` & `app/payouts/actions.ts`
4. Обновить клиентский SDK `lib/api/client.ts`.
5. Обновить компоненты интерфейса:
   - `components/connections/ConnectionAccrualsSection.tsx`
   - `app/leads/page.tsx`
   - `app/sellers/page.tsx`
   - `app/connections/page.tsx`
6. Синхронизировать `DB.md` и пересобрать `public/openapi.json`.
7. Запустить `npx tsc --noEmit` и `npm run build`.
8. Создать отчет верификации и зафиксировать коммит.
