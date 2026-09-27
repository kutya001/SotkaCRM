# План реализации: Исправление расчётного листа, добавление аванса и пакетное начисление бонусов подключений

**Дата:** 27-09-2026 21:35:00  
**Контекст:** Устранение ошибки `400 Bad Request` и `employee_payouts.employee_id does not exist`, внедрение операции `advance` (Аванс, знак `-`, кошелек обязателен), удаление вкладки расчётного листа из профиля, удаление «Вовлеченности» из реестра подключений и внедрение кнопки пакетного начисления бонусов подключений («Начислить бонусы»).

---

## 1. Архитектурные шаги

### Шаг 1. Миграция базы данных `019_fix_payroll_accruals_and_advance.sql`
1. Гарантировать наличие таблицы `employee_payouts` и колонок `employee_id UUID REFERENCES users(user_id)` и `user_id UUID REFERENCES users(user_id)` с триггером двусторонней синхронизации/COALESCE.
2. Создать/обновить представление `payouts` (`CREATE OR REPLACE VIEW payouts AS SELECT * FROM employee_payouts;`) для обратной совместимости.
3. Расширить ограничение `CHECK (operation_type IN (...))` добавлением `'advance'`.
4. Реализовать функцию `accrue_all_connections_bonuses(p_settlement_month VARCHAR(7))` с транзакционным начислением бонусов кураторам за подключение и сопровождение.
5. Обновить функцию `get_employee_payroll_sheet(p_employee_id UUID, p_month VARCHAR(7))` для возврата трёх детальных списков операций (`accruals`, `deductions_and_advances`, `payouts`) и итоговых сальдо.

### Шаг 2. Валидация и клиентские типы
1. `types/database.types.ts`: обновить тип операции, добавить `advance` и сигнатуру `accrue_all_connections_bonuses`.
2. `lib/validations/index.ts`:
   - Добавить `'advance'` в схемы операций по ЗП.
   - Обеспечить гибкий парсинг входных данных в `PayoutSchema` (`employeeId` | `employee_id`, `settlementMonth` | `settlement_month` и т.д.).
   - Автоматически выставлять `operation_sign`: `+` для начислений, `-` для удержаний, штрафов, выплат и авансов.
   - Для `advance` и `payout` требовать `payment_method` (`mbank`, `odengi`, `bakai`, `abank`, `cash`).

### Шаг 3. API маршруты и SDK клиент
1. `app/api/v1/payouts/route.ts`: нормализация входного JSON к snake_case перед передачей в контроллер/БД.
2. `app/api/v1/payouts/payroll-sheet/route.ts`: корректный маппинг `employeeId`/`employee_id` и возврат структуры расчётного листа.
3. `app/api/v1/connections/accrue-all/route.ts`: маршрут POST для вызова RPC `accrue_all_connections_bonuses`.
4. `lib/api/client.ts`: метод `api.connections.accrueAll(month)`.

### Шаг 4. Пользовательский интерфейс (Frontend)
1. `components/connections/AccrueBonusesModal.tsx`: модальное окно с выбором месяца (`YYYY-MM`) и кнопкой запуска пакетного начисления.
2. `app/connections/page.tsx`:
   - Полное удаление колонки, бейджей и фильтрации по «Вовлеченности».
   - Добавление кнопки «Начислить бонусы» в тулбар `DataJournal`.
3. `app/profile/page.tsx`:
   - Полное удаление компонента и вкладки расчётного листа сотрудника.
4. `components/payouts/PayrollSheetModal.tsx`:
   - Переработка в компактный вид: 3 строки сводки (Сальдо на начало -> 3 колонки Начислено/Удержано/Выплачено -> Сальдо на конец) + 3 таблицы по 4 колонки (`Дата`, `Месяц`, `Вид операции`, `Сумма`).
5. `app/payouts/page.tsx`:
   - Добавление типа «Аванс» (`advance`, `-`, выбор кошелька).

### Шаг 5. Документация и верификация
1. Обновление `DB.md` и `public/openapi.json`.
2. Проверка типов `npx tsc --noEmit` и сборка `npm run build`.
3. Формирование артефакта верификации `.antigravity/results/payroll_sheet_fix_advance_and_connections_accrual_verified-27-09-2026-21-50-00.md`.
