# Отчет о верификации: Биллинг сопровождения, Начисления, Расчетный листок и Выплаты

**Дата:** 27-09-2026  
**Статус:** Успешно верифицировано (Exit Code 0)  
**Контекст:** Реализация системы 2-месячного сопровождения, журнала начислений `connection_accruals`, биллинга `run_maintenance_billing`, непрерывного расчетного листка `get_employee_payroll_sheet`, расширенных способов выплат и исправления селектора кураторов.

---

## 1. Обзор реализованных модулей

### 1.1. База данных Supabase (Миграция `015_maintenance_accruals_payroll_and_methods.sql`)
1. **Расширение `connections`:**
   - Добавлены колонки: `maintenance_months_total` (default 2), `maintenance_month_start`, `maintenance_fee_monthly`, `connection_fee`.
2. **Таблица `connection_accruals`:**
   - Гранулярный учет каждого начисления (`connection` / `maintenance`) с привязкой к подключению, телефону продавца, сотруднику и расчетному месяцу (`YYYY-MM`).
   - Уникальный составной индекс `uq_conn_accrual (connection_id, accrual_type, settlement_month)` исключает дублирование начислений.
   - Исторический бэкфилл 11 существующих подключений выполнен без потерь данных.
3. **Расширение `employee_payouts`:**
   - Добавлены поля: `settlement_month` (`YYYY-MM`), `operation_type` (`payout` / `deduction`), `description`.
   - Поддержка платежных методов: `kaspi`, `halyk`, `oney`, `cash`, `card_transfer`.
4. **PostgreSQL RPCs:**
   - `link_lead_to_seller`: атомарная привязка лида с автосозданием подключения и первого начисления в `connection_accruals`.
   - `run_maintenance_billing(p_billing_month)`: биллинг абонплат за сопровождение с проверкой лимита месяцев и статуса. Идемпотентен.
   - `get_employee_payroll_sheet(p_employee_id, p_month)`: вычисление входящего сальдо, начислений, удержаний, выплат и исходящего непрерывного сальдо.
   - `process_employee_payout_atomic`: атомарная выплата/удержание с авто-проставлением `is_paid = true`, `payout_id` и `paid_at` в `connection_accruals`.

### 1.2. Backend REST API v1
- `POST /api/v1/connections/maintenance/billing`: запуск биллинга сопровождения администратором.
- `GET, POST /api/v1/connections/[id]/accruals`: получение и ручное добавление начислений.
- `PATCH, DELETE /api/v1/connections/[id]/accruals/[accrualId]`: редактирование и удаление начислений.
- `GET /api/v1/payouts/unpaid-accruals`: получение списка неоплаченных начислений для привязки к выплате.
- `POST /api/v1/payouts`: проведение выплаты/удержания с валидацией через `PayoutSchema` и атомарной привязкой.
- `GET /api/v1/profile/payroll`: получение расчетного листка сотрудника за выбранный месяц.

### 1.3. Frontend & UI/UX (Apple Island Glassmorphism)
1. **Селектор кураторов (`CuratorSelectDropdown.tsx`):**
   - Устранен баг наложения янтарного цвета браузерного `<select>`.
   - Реализован изолированный стеклянный popover с индивидуальными цветовыми метками сотрудников (`EmployeeColorDot`).
2. **Журнал подключений (`app/connections/page.tsx`):**
   - Добавлены колонки начисленных месяцев сопровождения и ставки абонплаты.
   - Модальное окно `MaintenanceBillingModal` с выбором месяца и запуском процедуры.
   - Секция `ConnectionAccrualsSection` внутри карточки/дровера подключения с таблицей начислений, бейджами статусов оплаты и кнопками действий.
3. **Выплаты (`app/payouts/page.tsx`):**
   - Переключатель «Выплата» / «Удержание».
   - Выбор платежного сервиса (`Kaspi`, `Halyk`, `О!Деньги`, `Наличные`, `Перевод на карту`).
   - Интерактивный чеклист неоплаченных начислений сотрудника с автоматическим суммированием.
4. **Расчетный листок в Профиле (`components/profile/EmployeePayslipTab.tsx`):**
   - Вкладка «Расчетный листок» для ролей `admin` и `consultant`.
   - Селектор расчетного месяца (`YYYY-MM`).
   - Сквозное сальдо: Входящее сальдо + Начислено - Удержано - Выплачено = Исходящее сальдо.
   - Таблицы детализации начислений, удержаний и фактических выплат.

---

## 2. Результаты автоматизированного тестирования

| Тест / Процедура | Команда / Скрипт | Результат | Примечание |
|---|---|---|---|
| Проверка типов TypeScript | `npx tsc --noEmit` | **Exit Code 0** | 0 ошибок типов во всех модулях |
| Биллинг и расчетный листок | `node scripts/verify-billing-payroll.mjs` | **Exit Code 0** | Идемпотентность биллинга и инвариант сальдо подтверждены |
| Rate Limiting & E2E Security | `npx tsx scripts/verify-e2e.mjs` | **Exit Code 0** | 6 проверочных блоков успешно пройдены |
| SWR Кэш & RPC оптимизация | `npx tsx scripts/verify-perf-swr.mjs` | **Exit Code 0** | Индексы, pg_trgm и кэш подтверждены |
| Production Build | `npm run build` | **Exit Code 0** | 46 статических/динамических маршрутов скомпилированы за 34.7s |

---

## 3. Соответствие манифестам проекта
- **`GEMINI.md`:** Запрет эмодзи соблюден (только Lucide React), актуализация `DB.md` выполнена, типизация строгая через `types/database.types.ts`.
- **`DB.md`:** Раздел 15 зафиксирован со всеми DDL и RPC сигнатурами.
- **`public/openapi.json`:** Спецификация OpenAPI 3.0.3 синхронизирована со всеми новыми роутами биллинга и расчетного листа.
