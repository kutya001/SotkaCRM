# Протокол верификации: Рефакторинг Кошелька, блокировка DELETE, массовые действия (Bulk Actions) и ролевая матрица

**Дата и время:** 27-09-2026 17:06:00
**Статус:** Успешно завершено (Код выхода: 0)

---

## 1. Резюме выполненных работ

### 1.1 Рефакторинг Кошелька («Кошелек» вместо «Инструмент расчета»)
- В БД (`employee_payouts`) и Zod-валидации (`lib/validations/index.ts`) закреплено строгое ограничение на 5 платежных систем Кыргызской Республики:
  - `mbank` — МБанк
  - `odengi` — О!Деньги
  - `bakai` — Бакай Банк
  - `abank` — АБанк (Айыл Банк)
  - `cash` — Наличка
- В интерфейсе `app/payouts/page.tsx`:
  - Столбец таблицы и поля форм переименованы в «Кошелек».
  - Настроены фирменные бейджи с векторными контурными иконками Lucide React (`Smartphone`, `Wallet`, `Landmark`, `Building2`, `Banknote`) без использования эмодзи.
  - Дефолтный метод при создании выплаты установлен в `mbank`.

### 1.2 Исключительное право удаления (Admin-Only DELETE)
- На уровне PostgreSQL RLS (миграция `017_security_wallet_and_role_permissions.sql`) удалены политики удаления для не-администраторских ролей. Для 8 таблиц сгенерированы строгие политики `<table_name>_admin_delete_policy` (`auth.uid() IN (SELECT user_id FROM users WHERE role = 'admin')`).
- В Next.js Route Handlers (`app/api/v1/**/[id]/route.ts`) во всех DELETE-методах внедрена строгая проверка `requireAdmin()` (HTTP 403 Forbidden для консультантов, SMM и супервайзеров).
- Физическое удаление лидов в `leads` блокируется триггером `prevent_lead_delete`; операция «Удаление» для роли `admin` переводит лид в статус `Отмена` с аудиторской отметкой в комментарии.

### 1.3 Интерактивный расчетный листок в модалке выплат (`app/payouts/page.tsx`)
- При выборе сотрудника в модальном окне реактивно вызывается эндпоинт `/api/v1/profile/payroll?employee_id=...&month=...`.
- Отображается компактная информационная панель сальдо за период:
  - Входящее сальдо (`opening_balance`)
  - Начислено за период (`total_accrued`)
  - Удержано / Выплачено (`total_deductions + total_paid`)
  - К выплате / Текущий остаток (`closing_balance`)
- Отображается интерактивный чеклист неоплаченных начислений с чекбоксами; при клике сумма в поле `amount` автоматически калькулируется из выбранных начислений.

### 1.4 Массовые действия (Bulk Actions) для Администратора
- Компонент `components/ui/DataJournal.tsx` расширен поддержкой мультиселекта строк (колонка чекбоксов в шапке и каждой строке, мемоизация `areRowPropsEqual`, корректировка `colSpan` виртуализатора).
- Реализован плавающий стеклянный островок массовых действий (Apple Island Glassmorphism) поверх таблицы и экрана при выборе $\ge 1$ строки.
- Созданы пакетные Route Handlers:
  - `POST /api/v1/leads/batch`: массовая смена статуса (`change_status`), переназначение куратора (`change_assigned`), массовое исключение (`delete` -> перевод в `Отмена`).
  - `POST /api/v1/sellers/batch`: массовое назначение куратора (`change_manager`), массовое удаление (`delete`).
- В клиентском SDK `lib/api/client.ts` добавлены методы `api.leads.batch` и `api.sellers.batch`.
- В `app/leads/page.tsx` и `app/sellers/page.tsx` подключены групповые селекторы и кнопки с подтверждением.

### 1.5 Тотальная изоляция Продавца-Консультанта (`consultant`)
- Лиды: строго `assigned_to = user_id`.
- Продавцы: строго `manager_id = user_id AND moderation = 'approved'` (в `app/api/v1/sellers/route.ts` и `[id]/route.ts`).
- Подключения: строго `manager_id = user_id`.
- Выплаты: строго `user_id = user_id AND status = 'paid'`.

### 1.6 Гранулярный доступ SMM к лидам
- Чтение (SELECT): видит **все** лиды базы для сквозной аналитики и мониторинга рекламных каналов (снят фильтр `created_by = user_id` в `app/api/v1/leads/route.ts`).
- Редактирование (UPDATE): разрешено **только** на стадиях «Открыт» и «Обработан». Попытка редактирования лида в статусе «Назначен», «Подписан» или «Отмена» возвращает HTTP 403 Forbidden на бэкенде и блокируется в интерфейсе (read-only режим, `canEditCurrentLead = false`).

---

## 2. Результаты тестов и верификации

1. **Unit & Functional Tests (`scripts/verify-wallet-bulk-isolation.mjs`):**
   - 26 из 26 тестов успешно пройдены (кошельки KG, схемы batch, изоляция SMM, права DELETE).
2. **Payouts Isolation & Deduplication Tests (`scripts/verify-payouts-isolation.mjs`):**
   - Все 5 блоков проверки пройдены (дедупликация upsert, 4-колоночный MobileBottomBar, миграция 016, документация).
3. **TypeScript Static Analysis:**
   - `npx tsc --noEmit` — 0 ошибок (Exit code 0).
4. **Production Build:**
   - `npm run build` — Успешно скомпилировано 48 статических и динамических маршрутов (Exit code 0).
5. **Синхронизация документации:**
   - `DB.md` обновлен (Раздел 17).
   - `public/openapi.json` обновлен (эндпоинты `/api/v1/leads/batch` и `/api/v1/sellers/batch`).
