# План: Обеспечение строгого нулевого отображения бонусов в Подключениях до момента проводки и сквозная верификация регистра накопления ЗП

## 1. Анализ проблемы и текущего состояния
1. В таблице `connections` имеются поля `connection_fee` и `maintenance_fee_monthly` — это плановые тарифные ставки.
2. В интерфейсе `app/connections/page.tsx` и `app/api/v1/connections/route.ts` в ряде сценариев эти плановые ставки подставлялись в столбцы «Бонус подключения» и «Бонус сопровождения» до фактического проведения начислений.
3. Единым бухгалтерским регистром накопления начислений и удержаний выступает таблица `employee_payouts`.
4. До нажатия кнопки «Начисления» (которая генерирует проводки с `operation_sign = '+'` в `employee_payouts`) суммы бонусов в таблице подключений должны быть строго равны `0` (или `0 с`).

## 2. Пошаговый план реализации

### Шаг 1. SQL представление и миграция `026_strict_zero_bonuses_until_accrued.sql`
- Создание представления `connections_with_accruals`, вычисляющего:
  - `bonus_connection_accrued`: фактическая сумма проводок `ep.operation_type = 'accrual_connection' AND ep.operation_sign = '+'`
  - `bonus_maintenance_accrued`: фактическая сумма проводок `ep.operation_type = 'accrual_maintenance' AND ep.operation_sign = '+'`
  - `total_bonuses_accrued`: общая сумма начисленных бонусов
  - `maintenance_months_accrued_count`: число уникальных расчетных месяцев сопровождения из `employee_payouts`
- Настройка прав доступа (GRANT SELECT ON connections_with_accruals TO authenticated, service_role).
- Применение миграции в live-базу Supabase через MCP tool `execute_sql`.
- Актуализация `DB.md`.

### Шаг 2. Бэкенд API (`app/api/v1/connections/route.ts` и `[id]/route.ts`)
- Запрос выборки подключений перевести на `connections_with_accruals` (или с джойном/агрегатами).
- В ответе возвращать:
  - `bonus_connection`: строго `bonus_connection_accrued`
  - `bonus_maintenance`: строго `bonus_maintenance_accrued`
  - `total_bonuses`: строго `total_bonuses_accrued`
  - `tariff_connection_fee` и `tariff_maintenance_fee_monthly`: плановые тарифные ставки (для справочного блока в модальном окне).

### Шаг 3. Клиентский интерфейс «Подключения» (`app/connections/page.tsx`, `ConnectionAccrualsSection.tsx`)
- В табличном и карточном представлении:
  - Столбец «Бонус подключения»: строго `formatMoney(item.bonus_connection)` (если 0 — '0 с').
  - Столбец «Бонус сопровождения»: строго `formatMoney(item.bonus_maintenance)` (если 0 — '0 с').
  - Столбец «Итого бонусы»: строго `formatMoney(item.total_bonuses)` (если 0 — '0 с').
- В детальной карточке:
  - Справочный блок «Тарифные условия»: выводить плановые ставки `tariff_connection_fee` и `tariff_maintenance_fee_monthly`.
  - Блок «Фактические проводки ЗП»: компактное отображение реальных строк из `employee_payouts`.

### Шаг 4. Проверка и верификация модуля «Операции по ЗП» (`app/payouts/page.tsx`)
- Обеспечить сквозное отображение проводок по подключениям и сопровождению с зеленым бейджем `+`, указанием продавца и подключения.

### Шаг 5. Сборка и коммит
- Проверка `npm run build` / `npx tsc --noEmit`.
- Фиксация в `origin/main`.
- Оформление отчета в `.antigravity/results/`.
