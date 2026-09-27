# План реализации: Рефакторинг модуля Подключений (Сопровождение 2 мес, Начисления, Биллинг), исправление селектора кураторов, методы выплат и Расчетный лист в Профиле

**Дата:** 27-09-2026 12:50:00  
**Статус:** В работе  
**Соответствие спецификациям:** `GEMINI.md`, `DB.md`, `ТЗ.md`, `UxUi.md`

---

## 1. Цели и задачи этапа

1. **Фронтенд — исправление селектора кураторов (`app/sellers/page.tsx`, `components/ui/DataJournal.tsx`):**
   - Устранение каскадного окрашивания всплывающего списка в янтарный цвет (`bg-amber-100` / `text-amber-800`).
   - Изоляция всплывающего меню: нейтральный матовый темный фон `bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl`.
   - Точечная подсветка: цветной круг `<span style={{ backgroundColor: emp.color }} />` и имя сотрудника `<span style={{ color: emp.color }}>`. Строка «— Не назначен —» нейтрального серого цвета.

2. **База данных Supabase — миграция `015_maintenance_accruals_payroll_and_methods.sql`:**
   - Модификация `connections`:
     - Добавление колонок: `maintenance_months_total` (default 2), `maintenance_month_start` ('YYYY-MM'), `maintenance_fee_monthly` (numeric), `connection_fee` (numeric).
     - Дефолтный статус при привязке куратора — строго `'подключен'`.
     - Статусы жизненного цикла: `'подключен'`, `'сопровождение'`, `'приостановлен'`, `'расторгнут'`.
   - Создание таблицы `connection_accruals`:
     - Колонки: `id UUID`, `connection_id UUID`, `seller_phone VARCHAR(20)`, `employee_id UUID`, `accrual_type ('connection', 'maintenance')`, `settlement_month VARCHAR(7)`, `amount NUMERIC(12,2)`, `is_paid BOOLEAN`, `payout_id UUID`, `paid_at TIMESTAMPTZ`, `notes TEXT`.
     - Ограничение уникальности `uq_conn_accrual (connection_id, accrual_type, settlement_month)`.
     - Индексы и политики RLS.
   - Модификация `employee_payouts`:
     - Добавление `settlement_month VARCHAR(7)`, `operation_type VARCHAR(20) DEFAULT 'payout' CHECK (operation_type IN ('payout', 'deduction'))`.
     - Валидация методов оплаты: `cash`, `kaspi`, `halyk`, `oney`, `card_transfer`.
   - Обновление RPC `link_lead_to_seller`:
     - Создание связи со статусом `'подключен'`.
     - Расчет `connection_fee` и `maintenance_fee_monthly`.
     - Вычисление `maintenance_month_start` (месяц подключения + 1).
     - Генерация первичного начисления `'connection'` в `connection_accruals`.
   - Создание RPC `run_maintenance_billing(p_billing_month VARCHAR(7))`:
     - Помесячная генерация начислений `'maintenance'` для активных подключений со статусом `'подключен'` или `'сопровождение'`.
     - Контроль лимита `maintenance_months_total`.
     - Перевод статуса в `'сопровождение'`.
   - Создание RPC `get_employee_payroll_sheet(p_employee_id UUID, p_month VARCHAR(7))`:
     - Расчет `opening_balance`, `total_accrued`, `total_deductions`, `total_paid`, `closing_balance` по непрерывному сальдовому методу.
     - Детализация по продавцам, удержаниям и фактам выплат с указанием шлюзов.
   - Актуализация `DB.md` и `types/database.types.ts`.

3. **Бэкенд-маршруты API v1:**
   - `POST /api/v1/connections/maintenance/billing`: вызов RPC `run_maintenance_billing`.
   - `GET /api/v1/connections/[id]/accruals`: получение списка начислений по сделке.
   - `PATCH /api/v1/connections/[id]/accruals/[accrualId]`: редактирование суммы/месяца начисления.
   - `PATCH /api/v1/connections/[id]`: обновление срока сопровождения и ежемесячной ставки.
   - `GET /api/v1/payouts/unpaid-accruals`: получение неоплаченных начислений сотрудника за месяц.
   - `POST /api/v1/payouts`: поддержка методов `kaspi`, `halyk`, `oney`, `cash`, `card_transfer`, удержаний и привязки `accrual_ids`.
   - `GET /api/v1/profile/payroll`: получение расчетного листка сотрудника.

4. **Клиентский SDK (`lib/api/client.ts`) и OpenAPI (`public/openapi.json`):**
   - Добавление новых методов SDK и схем спецификации OpenAPI 3.0.3.

5. **Пользовательский интерфейс (Frontend):**
   - `app/sellers/page.tsx`: кастомный селектор куратора без утечки желтого цвета.
   - `app/connections/page.tsx`: отображение колонок срока, прогресса и суммы сопровождения, модалка запуска биллинга, график начислений в детальной карточке с возможностью ручной отметки оплаты.
   - `app/payouts/page.tsx`: выбор платежного метода (Kaspi, Halyk, Oney, Карта, Наличные), переключатель Выплата/Удержание, интерактивный выбор начислений с автоподсчетом суммы.
   - `app/profile/page.tsx`: вкладка «Расчётный листок» с KPI-карточками сальдо и тремя детализированными таблицами.

---

## 2. Пошаговый план внедрения

| Шаг | Зона | Файлы | Описание |
|---|---|---|---|
| 1 | DB | `supabase/migrations/015_maintenance_accruals_payroll_and_methods.sql` | DDL миграции, триггеры, RPC `run_maintenance_billing`, `get_employee_payroll_sheet`, обновление `link_lead_to_seller` |
| 2 | Документация | `DB.md`, `types/database.types.ts` | Синхронизация манифеста DB и типизации TypeScript |
| 3 | Backend | `app/api/v1/connections/...`, `app/api/v1/payouts/...`, `app/api/v1/profile/payroll/...` | Новые эндпоинты начислений, биллинга, удержаний и расчетного листка |
| 4 | SDK & OpenAPI | `lib/api/client.ts`, `public/openapi.json` | Синхронизация методов SDK и OpenAPI |
| 5 | Frontend | `app/sellers/page.tsx` | Исправление бага селектора кураторов |
| 6 | Frontend | `app/connections/page.tsx` | Колонки сопровождения, модалка биллинга, график начислений |
| 7 | Frontend | `app/payouts/page.tsx` | Методы оплаты, удержания, привязка начислений |
| 8 | Frontend | `app/profile/page.tsx` | Вкладка расчетного листка (Payslip) |
| 9 | Верификация | `scripts/verify-billing-payroll.mjs`, `npm run build` | Автотесты, проверка типов и сборка проекта |
| 10 | Отчет | `.antigravity/results/maintenance_billing_accruals_and_payroll_sheet_verified-*.md` | Фиксация результатов |
