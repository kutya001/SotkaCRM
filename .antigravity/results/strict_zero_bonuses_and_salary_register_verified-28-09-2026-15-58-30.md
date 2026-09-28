# Отчет о верификации: строгое нулевое отображение бонусов до момента проводки и сквозной регистр ЗП

**Дата:** 28-09-2026 15:58:30
**Статус:** Выполнено успешно

---

## 1. Решенные проблемы

1. **Отображение плановых ставок до начисления:**
   - Ранее в столбцах «Бонус подключения» и «Бонус сопровождения» модуля «Подключения» отображались плановые тарифные ставки (`connection_fee`, `maintenance_fee_monthly`), вводя пользователя в заблуждение до проведения начислений.
   - **Решение:** Создано представление `connections_with_accruals`, вычисляющее фактические суммы из проводок со знаком `+` в `employee_payouts`. До проведения начислений в столбцах таблицы строго отображается `0 сом`.

2. **Ограничения и недостающие поля в `employee_payouts`:**
   - В таблице `employee_payouts` отсутствовали столбцы `connection_id`, `seller_phone`, `operation_sign`, `actual_date`, `note`, `settlement_month`.
   - Ограничение `employee_payouts_operation_type_check` разрешало только `'payout'` и `'deduction'`, блокируя проведение начислений (`accrual_connection`, `accrual_maintenance`, `salary_base`, `bonus_other`, `advance`, `fine`).
   - **Решение:** Миграция `026_strict_zero_bonuses_until_accrued.sql` добавила все требуемые столбцы, расширила ограничение `operation_type` и применила индексы. Изменения выполнены непосредственно в СУБД Supabase через MCP tool.

3. **Сквозная связка «Подключения» $\rightarrow$ «Операции по ЗП»:**
   - Процедура `accrue_connection_bonuses_v2` регистрирует проводки со знаком `+`, связывая их с `connection_id`, сотрудником и продавцом.
   - В модуле «Операции по ЗП» проводки выводятся с типом «Начисление по подключению» или «Начисление по сопровождению (YYYY-MM)», зеленым бейджем `+` и указанием привязанного клиента.

---

## 2. Модифицированные и созданные файлы

* `supabase/migrations/026_strict_zero_bonuses_until_accrued.sql` — миграция представления `connections_with_accruals`, колонок `employee_payouts` и процедуры `accrue_connection_bonuses_v2`.
* `DB.md` — актуализация физической спецификации (Раздел 24).
* `app/api/v1/connections/route.ts` — переход на представление `connections_with_accruals`, возвращение строгих нулей при отсутствии проводок, разделение на фактические бонусы и плановые тарифы.
* `app/api/v1/connections/[id]/route.ts` — выдача плановых ставок `tariff_connection_fee`, `tariff_maintenance_fee_monthly` и фактических `total_bonuses`.
* `app/api/v1/connections/accrue-all/route.ts` — приоритетный вызов хранимой процедуры `accrue_connection_bonuses_v2`.
* `app/connections/actions.ts` — актуализация подсчета KPI-статистики и интерфейса `ConnectionItem`.
* `app/connections/page.tsx` — отображение `0 сом` в столбцах до проводки, вывод плановых ставок и фактических начислений в модальном окне.
* `app/payouts/page.tsx` — отображение проводок с основанием, номером телефона клиента и бейджами типа операции.
* `types/database.types.ts` — добавление типа представления `connections_with_accruals`.

---

## 3. Результаты сборки и тестов
- `npx tsc --noEmit` — Exit Code 0 (ошибок типизации нет).
- `next build` — Exit Code 0 (51 страница оптимизирована и собрана успешно).
