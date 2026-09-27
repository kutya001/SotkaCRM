# Отчёт о верификации: Исправление расчётного листа, добавление операции «Аванс» и пакетное начисление бонусов подключений

**Дата:** 27-09-2026 21:50:00  
**Статус:** Успешно верифицировано (Exit Code 0, 50/50 страниц Next.js скомпилированы)

---

## 1. Решённые проблемы и архитектурные изменения

### 1.1. Устранение ошибки `400 Bad Request` и `employee_payouts.employee_id does not exist`
* **Проблема:** Рассинхронизация схемы базы данных между `user_id` и `employee_id` приводила к сбою вызова PostgREST и падению эндпоинта `/api/v1/payouts/payroll-sheet` с кодом 400.
* **Решение:**
  - В миграции `019_fix_payroll_accruals_and_advance.sql` гарантировано наличие колонки `employee_id UUID REFERENCES users(user_id) ON DELETE CASCADE`.
  - Внедрён триггер `trg_sync_employee_payouts_ids`, автоматически выравнивающий `user_id` и `employee_id` при любых операциях.
  - Создано представление `public.payouts AS SELECT * FROM public.employee_payouts` для полной обратной совместимости.
  - В `app/payouts/actions.ts` (`getPayrollSheetAction`) и `app/api/v1/payouts/payroll-sheet/route.ts` реализован вызов RPC `get_employee_payroll_sheet` с безопасным fallback-запросом, исключающим падение при запросах с любым из идентификаторов.

### 1.2. Вид операции «Аванс» (`advance`)
* Добавлен тип `advance` в схему `salaryOperationTypeSchema` и `CHECK (operation_type IN (...))`.
* Знак операции строго `'-'`.
* Выбор кошелька (`mbank`, `odengi`, `bakai`, `abank`, `cash`) является обязательным для авансов и выплат.
* В форме модального окна добавления операции по ЗП (`app/payouts/page.tsx`) добавлен пункт «Аванс (- Выплата)» с автоматической активацией селектора кошелька.

### 1.3. Пакетное начисление бонусов подключений (`accrue_all_connections_bonuses`)
* В миграции 019 создана хранимая процедура `accrue_all_connections_bonuses(p_settlement_month VARCHAR(7))`:
  - **ШАГ 1:** Начисляет недостающие вознаграждения консультантам за подключение клиента (`accrual_connection`, `+`).
  - **ШАГ 2:** Начисляет ежемесячное сопровождение (`accrual_maintenance`, `+`) с проверкой активности продавца (`sellers.is_active = true`) и FSM-переводом статуса в `'сопровождение'` / `'готов'`.
* Создан серверный эндпоинт `POST /api/v1/connections/accrue-all`.
* Добавлен клиентский метод `api.connections.accrueAll(month)` с инвалидацией кэша.
* Создан компонент `AccrueBonusesModal.tsx` с выбором месяца и вызовом начисления.
* В тулбар подключений (`app/connections/page.tsx`) добавлена кнопка «Начислить бонусы» (доступна администратору).

### 1.4. Очистка интерфейса и редизайн расчётного листка
* **`app/connections/page.tsx`:** Удалены все неиспользуемые метрики и упоминания «Вовлеченности».
* **`app/profile/page.tsx`:** Полностью удалена вкладка расчётного листка (`EmployeePayslipTab`), оставлены только целевые KPI-дашборды сотрудников.
* **`components/payouts/PayrollSheetModal.tsx`:** Реализован компактный дизайн:
  - **Строка 1:** Входящий остаток (Сальдо на начало месяца).
  - **Строка 2:** 3-колоночная сетка (`Начислено (+)` | `Удержания / Авансы (-)` | `Выплачено (-)`).
  - **Строка 3:** Исходящий остаток (К выплате) в виде крупного акцентного бейджа.
  - **Детализация:** Вкладки с 4-колоночными компактными таблицами `[ Дата | Месяц | Вид операции | Сумма ]`.

---

## 2. Результаты тестов сборки и валидации

```bash
npx tsc --noEmit
# Exit code: 0 (Ошибок типизации нет)

npm run build
# Exit code: 0
# Route (app) - 50 dynamic & static routes compiled successfully
```

## 3. Синхронизированные манифесты документации
* `DB.md` — обновлена спецификация `employee_payouts`, добавлен тип `advance`, описана Миграция 019.
* `public/openapi.json` — обновлена спецификация OpenAPI (45 эндпоинтов, добавлены `/api/v1/connections/accrue-all` и `/api/v1/payouts/payroll-sheet`).
