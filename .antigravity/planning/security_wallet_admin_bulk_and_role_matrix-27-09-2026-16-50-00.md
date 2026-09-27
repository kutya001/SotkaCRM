# План реализации: Рефакторинг Кошелька, глобальная блокировка удаления (Admin only), расчетный лист в модалке выплат, массовое редактирование для Admin, сквозная изоляция консультанта и права SMM

**Дата создания:** 27-09-2026  
**Ветка:** `main`  
**Исполнитель:** DeepMind Antigravity  

---

## 1. Архитектурный анализ и постановка задач

### Задача 1. Платежные методы («Кошелек» вместо «Инструмент расчета»)
* **Требование:** строго фиксированный список платежных систем Кыргызстана:
  - `mbank` — МБанк
  - `odengi` — О!Деньги
  - `bakai` — Бакай Банк
  - `abank` — АБанк (Айыл Банк)
  - `cash` — Наличка
* **Реализация:**
  - В `lib/validations/index.ts`: обновить `paymentMethodSchema = z.enum(['mbank', 'odengi', 'bakai', 'abank', 'cash'])`.
  - В `supabase/migrations/017_security_wallet_and_role_permissions.sql`:
    `ALTER TABLE employee_payouts DROP CONSTRAINT IF EXISTS employee_payouts_payment_method_check;`
    `ALTER TABLE employee_payouts ADD CONSTRAINT employee_payouts_payment_method_check CHECK (payment_method IN ('mbank', 'odengi', 'bakai', 'abank', 'cash'));`
  - В `app/payouts/page.tsx`:
    - Переименовать лейбл поля в форме создания: «Кошелек».
    - Селектор вариантов с новыми ключами (`mbank`, `odengi`, `bakai`, `abank`, `cash`) и контурными векторными иконками Lucide React (без эмодзи).
    - Рендеринг бейджей метода оплаты в таблице DataJournal с обновленными цветами и названиями.

### Задача 2. Исключительное право удаления (Admin only)
* **RLS PostgreSQL (миграция 017):**
  - Блокировка `DELETE` для всех не-администраторов на таблицах: `leads`, `sellers`, `connections`, `employee_payouts`, `employee_rates`, `plans`, `connection_accruals`, `users`:
    `USING ((SELECT public.get_current_user_role()) = 'admin')`
* **API Route Handlers:**
  - Во всех маршрутах `DELETE`:
    - `app/api/v1/leads/[id]/route.ts`
    - `app/api/v1/sellers/[id]/route.ts`
    - `app/api/v1/connections/[id]/route.ts`
    - `app/api/v1/payouts/[id]/route.ts`
    - `app/api/v1/plans/[id]/route.ts`
    - `app/api/v1/rates/[id]/route.ts`
    - `app/api/v1/employees/[id]/route.ts`
    - `app/api/v1/connections/[id]/accruals/[accrualId]/route.ts`
    - Проверка `requireAdmin()` или возврат `HTTP 403 Forbidden` (`{ error: 'Удаление записей разрешено только администратору' }`).
* **UI:**
  - Скрыть кнопки «Удалить» и пункты контекстного меню ПКМ во всех модулях для пользователей с `currentUserRole !== 'admin'`.

### Задача 3. Интерактивный расчетный листок внутри модалки выплат (`app/payouts/page.tsx`)
* **Поведение:**
  - При выборе сотрудника (`formData.user_id`) в модалке создания выплаты:
    - Выполняется реактивный запрос к `api.profile.getPayrollSheet({ employeeId: formData.user_id, month: formData.accrual_month || selectedMonth })`.
    - Отображается информационная карточка расчетного листка:
      * Сальдо на начало месяца
      * Начислено за месяц
      * Удержано
      * К выплате (исходящее сальдо) — акцентным цветом
    - Список доступных начислений куратора (`accruals`) с чекбоксами: выбор строк пересчитывает сумму выплаты `formData.amount` и связывает `selectedAccrualIds`.

### Задача 4. Массовое редактирование (Bulk Actions) для Администратора
* **`components/ui/DataJournal.tsx`:**
  - Поддержка bulk-действий: пропсы `enableBulkActions?: boolean`, `selectedRowIds: string[]`, `onSelectRow: (id: string) => void`, `onSelectAll: (all: boolean) => void`.
  - Колонка чекбоксов в табличном виде (`Table View`) слева от первой колонки данных:
    * Чекбокс «Выбрать все» в шапке `<th>`.
    * Построчные чекбоксы в ячейках `<td>`.
  - Плавающая нижняя панель действий (Bulk Action Bar):
    * Индикатор количества выбранных записей (`Выбрано: N`).
    * Кнопки действий: смена статуса (dropdown), назначение ответственного/куратора (dropdown), удаление, снять выбор.
* **Пакетные эндпоинты API:**
  - `POST /api/v1/leads/batch`:
    * `{ action: 'change_status' | 'change_assigned' | 'delete', ids: string[], payload?: any }`
    * Доступно строго для роли `admin`.
  - `POST /api/v1/sellers/batch`:
    * `{ action: 'change_manager' | 'delete', ids: string[], payload?: any }`
    * Доступно строго для роли `admin`.
* **Интеграция в страницы:**
  - В `app/leads/page.tsx` и `app/sellers/page.tsx` для роли `admin`.

### Задача 5. Тотальная изоляция консультанта (`consultant`)
* **Лиды (`leads`):** консультант видит исключительно свои лиды (`assigned_to = profile.user_id`).
* **Продавцы (`sellers`):** консультант видит только одобренных продавцов (`moderation = 'approved'`), закрепленных за ним (`manager_id = profile.user_id`). Нераспределенные или чужие продавцы не отображаются.
* **Подключения (`connections`):** консультант видит только свои подключения (`manager_id = profile.user_id`).
* **Выплаты (`employee_payouts`):** консультант видит только свои выплаты (`user_id = profile.user_id`) со статусом `paid`.
* **Планы (`plans`):** консультант видит активные тарифные планы для работы с клиентами.

### Задача 6. Гранулярный доступ SMM к лидам
* **Чтение (`SELECT`):** SMM видит **все** лиды базы без фильтрации по создателю.
* **Обновление (`UPDATE`):**
  - На стадиях «Открыт» и «Обработан»: SMM имеет право редактировать лид, менять статус, добавлять комментарии.
  - На стадиях «Назначен», «Подписан», «Отмена»: лид становится строго Read-Only для SMM.
  - На бэкенде (`app/api/v1/leads/[id]/route.ts`, `app/api/v1/leads/[id]/status/route.ts`): при попытке редактирования SMM возвращать 403 Forbidden.
  - На фронтенде (`app/leads/page.tsx`): отключать селекторы, прятать кнопки смены статуса в ПКМ, форму модалки переводить в `readOnly`.

---

## 2. Пошаговый план работ

1. **Шаг 1: Миграция 017 и валидация Wallet**
   - Написать `supabase/migrations/017_security_wallet_and_role_permissions.sql`.
   - Обновить схему кошелька в `lib/validations/index.ts`.
2. **Шаг 2: API Route Handlers**
   - Создать `POST /api/v1/leads/batch` и `POST /api/v1/sellers/batch`.
   - Обновить `DELETE` методы во всех API роутах с жестким ограничением `role === 'admin'`.
   - Обновить `PATCH /api/v1/leads/[id]` и `status` с проверкой прав SMM на стадии «Назначен», «Подписан», «Отмена».
   - Добавить методы batch в `lib/api/client.ts`.
3. **Шаг 3: Массовые операции в `DataJournal.tsx`**
   - Добавить поддержку чекбоксов строк, «Выбрать все» и Bulk Action Bar.
4. **Шаг 4: UI Лидов (`app/leads/page.tsx`) и Продавцов (`app/sellers/page.tsx`)**
   - Интегрировать Bulk Actions для администратора.
   - Реализовать Read-Only блокировку для SMM на закрытых этапах воронки.
   - Изолировать выборку продавцов и лидов для консультанта (`manager_id = user_id`, `assigned_to = user_id`).
5. **Шаг 5: Выплаты и Кошелек (`app/payouts/page.tsx`)**
   - Переименовать в «Кошелек», обновить 5 опций (МБанк, О!Деньги, Бакай Банк, АБанк, Наличка).
   - Встроить реактивную карточку расчетного листка и чекбоксы начислений прямо в модалку создания выплаты.
6. **Шаг 6: Документация, сборка и верификация**
   - Актуализировать `DB.md` и `public/openapi.json`.
   - Провести проверку типов `npx tsc --noEmit`.
   - Запустить тестовые сценарии и сборку `npm run build`.
   - Оформить отчет в `.antigravity/results/`.
