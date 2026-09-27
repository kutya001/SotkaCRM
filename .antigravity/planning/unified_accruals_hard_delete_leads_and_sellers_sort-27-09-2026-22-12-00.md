# План реализации: Единые начисления, жесткое удаление лидов администратором и детерминированная сортировка продавцов

**Дата:** 27-09-2026 22:12:00  
**Контекст:** Устранение ошибки 400 на роуте `POST /api/v1/connections/accrue-all`, объединение биллинга и начислений в единую кнопку «Начисления», детерминированная сортировка продавцов по `registered_at`, удаление тяжелых полей выплаченности в Подключениях, и внедрение физического (Hard) удаления лидов администратором с подтверждением.

---

## 1. Архитектурный план

### Шаг 1. Миграция базы данных `020_hard_delete_leads_and_unified_accruals.sql`
1. **Триггер и RLS физического удаления лидов (`leads`):**
   - Заменить триггер `prevent_lead_delete` функцией `check_lead_deletion_permission()`.
   - Разрешить `DELETE` исключительно для роли `admin` (`(SELECT public.get_current_user_role()) = 'admin'`).
   - Для остальных ролей вызывать исключение `RAISE EXCEPTION 'Удаление записей лидов разрешено только администратору'`.
   - Обновить RLS политику `leads_delete_policy` на таблицу `leads`: `FOR DELETE TO authenticated USING ((SELECT public.get_current_user_role()) = 'admin')`.
2. **Единая хранимая процедура `process_unified_connection_accruals(p_settlement_month VARCHAR(7))`:**
   - Транзакционная проверка всех активных подключений с активными продавцами (`sellers.is_active = true` AND `connections.manager_id IS NOT NULL`).
   - Начисление недостающего бонуса за подключение (`accrual_connection`, `+`).
   - Начисление ежемесячного бонуса за сопровождение (`accrual_maintenance`, `+`) с проверкой срока и FSM переводом статуса.
   - Также создать алиас/синоним `accrue_all_connections_bonuses` для обратной совместимости.

### Шаг 2. Бэкенд и роуты API
1. **`app/api/v1/connections/accrue-all/route.ts`:**
   - Полиморфный парсинг тела запроса: извлечение `month`, `settlement_month` или `settlementMonth`.
   - При отсутствии тела — подстановка текущего месяца `YYYY-MM`.
   - Строгая валидация формата `/^\d{4}-\d{2}$/`.
   - Вызов RPC `process_unified_connection_accruals` (с fallback на `accrue_all_connections_bonuses`).
   - Возврат детального JSON-ответа с кодом 200 или сообщения об ошибке при сбое.
2. **`app/api/v1/leads/[id]/route.ts`:**
   - В методе `DELETE`: проверка `profile.role === 'admin'` (иначе 403 Forbidden).
   - Выполнение прямого удаления `supabase.from('leads').delete().eq('lead_id', leadId)`.
3. **`app/api/v1/sellers/route.ts`:**
   - Фиксация стабильной детерминированной сортировки по умолчанию:
     `.order('registered_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })`.
   - Назначение куратора не будет менять позицию продавца в реестре.
4. **`lib/api/client.ts`:**
   - Обновление метода `api.connections.accrueAll` для отправки `{ month, settlement_month: month }`.
   - Проверка наличия `api.leads.delete(id)` с инвалидацией пространств имен `leads`, `sellers`, `connections`, `dashboard`, `analytics`.

### Шаг 3. Пользовательский интерфейс (Frontend)
1. **`app/connections/page.tsx`:**
   - Удаление колонок «Выплачено» (`total_paid`) и «Остаток» (`balance_remaining`), снятие лишней вычислительной нагрузки.
   - Удаление раздельных кнопок «Биллинг сопровождения» и «Начислить бонусы».
   - Добавление единой кнопки в тулбар: **«Начисления»** (иконка Lucide `Calculator` или `Coins`).
   - Интеграция модального окна начислений с выбором расчетного месяца, описанием и запуском `api.connections.accrueAll`.
2. **`app/leads/page.tsx`:**
   - Добавление кнопки «Удалить навсегда» в контекстные действия строки и карточку/модалку лида для роли `admin`.
   - Реализация диалога подтверждения безвозвратного удаления с предупреждением о последствиях.
   - Удаление записи из локального состояния без необходимости перезагрузки страницы.

### Шаг 4. Документация и верификация
1. Обновление `DB.md` и `public/openapi.json`.
2. Проверка типов `npx tsc --noEmit`.
3. Полная сборка проекта `npm run build` (Exit Code 0).
4. Создание артефакта верификации `.antigravity/results/unified_accruals_hard_delete_leads_and_sellers_sort_verified-27-09-2026-22-30-00.md`.
5. Git commit & push.
