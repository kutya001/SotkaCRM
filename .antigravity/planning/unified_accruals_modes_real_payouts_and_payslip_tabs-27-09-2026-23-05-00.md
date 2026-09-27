# План: Реорганизация начислений по подключениям (режимы: все / подключение / сопровождение), реальные проводки в карточке, редактирование срока сопровождения, редизайн Расчетного листка и замена swagger-ui-react

**Дата:** 27-09-2026 23:05:00  
**Цель:** Реализация новой целевой архитектуры взаиморасчетов с реальными проводками в `employee_payouts`, гибкими режимами начислений, редактированием срока сопровождения, редизайном Расчетного листка на 3 столбца KPI и 4 вкладки проводок, а также устранением npm предупреждений ERESOLVE путем миграции на `swagger-ui-dist`.

---

## 1. Декомпозиция этапов

### Этап 1: Миграция БД и схема данных (`021_unified_accruals_modes_and_connection_cleanup.sql`)
1. Расширение таблицы `employee_payouts` колонками `connection_id`, `seller_phone`, `employee_id`, `operation_sign`, `actual_date`, `note`, `status` (если отсутствуют).
2. Снятие ограничения NOT NULL с `payment_method` и расширение `operation_type` значениями `accrual_connection`, `accrual_maintenance`, `salary_base`, `bonus_other`, `advance`, `payout`, `deduction`.
3. Создание функции `accrue_connection_bonuses_v2(p_mode VARCHAR, p_settlement_month VARCHAR)` с поддержкой режимов `'all'`, `'connection_only'`, `'maintenance_only'` и учетом `maintenance_months_total`.
4. Обновление `DB.md`.

### Этап 2: API Route Handlers
1. `app/api/v1/connections/accrue-all/route.ts`:
   - Прием `{ mode, month }` (с обратной совместимостью).
   - Вызов RPC `accrue_connection_bonuses_v2` с автономным нативным fallback в TypeScript (для работы даже без ручного выполнения SQL в Supabase).
2. `app/api/v1/connections/[id]/accruals/route.ts`:
   - Возврат реальных проводок из `employee_payouts` по `connection_id = id` (с fallback на `connection_accruals`).
   - Поддержка создания/удаления.
3. `app/api/v1/payouts/[id]/route.ts`:
   - Реализация/доработка `PATCH` для роли `admin`: редактирование `actual_date`, `settlement_month`, `amount`, `note`.
4. `app/api/v1/connections/[id]/route.ts`:
   - Поддержка обновления `maintenance_months_total` (целое число $\ge 1$).

### Этап 3: Фронтенд модуля «Подключения»
1. `components/connections/AccrueBonusesModal.tsx`:
   - 3 режима: «Все начисления» (`all`), «Только за подключения» (`connection_only`), «Только за сопровождение» (`maintenance_only`).
   - Выбор месяца `YYYY-MM`.
   - Отправка в `api.connections.accrueAll`.
2. `components/connections/ConnectionAccrualsSection.tsx`:
   - Удаление старого виртуального графика.
   - Отображение таблицы реальных проводок по ЗП (`[ Дата | Месяц | Вид операции | Сумма | Действия ]`).
   - Для `admin`: редактирование даты, месяца, суммы и примечания через модалку.
3. `app/connections/page.tsx`:
   - Добавление инпута редактирования срока сопровождения `maintenance_months_total` для `admin`.
   - Динамический расчет бонусов по реальным проводкам подключения.

### Этап 4: Редизайн Расчетного листка (`PayrollSheetModal.tsx`)
1. Верхний аналитический блок: 3 параллельных столбца KPI (Начислено / Удержано / Выплачено) + строка сальдо (Сальдо нач $\to$ Сальдо кон).
2. Нижний табличный блок с вкладками (Все / Начисления / Удержания / Выплаты) и 4 компактными колонками `[ Дата | Месяц | Вид операции | Сумма ]`.

### Этап 5: Замена `swagger-ui-react` на `swagger-ui-dist` и `.npmrc`
1. Удаление `swagger-ui-react` и установка `swagger-ui-dist`, `@types/swagger-ui-dist`.
2. Обновление `components/docs/SwaggerDocs.tsx` через `SwaggerUIBundle` и ref.
3. Добавление `scarf-analytics=false` в `.npmrc`.

### Этап 6: Сборка, верификация и коммит
1. `npx tsc --noEmit`.
2. `npm run build`.
3. Создание отчета верификации и пуш в `main`.
