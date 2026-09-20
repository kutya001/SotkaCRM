# Отчет о верификации исправления foreign key sellers_plan_id_fkey и дедупликации батчей синхронизации

**Дата:** 20.09.2026  
**Статус:** Успешно верифицировано (Синхронизация продавцов и платежей протестирована на живой БД Supabase)

---

## 1. Диагностика и первопричина сбоя

### 1.1. Нарушение внешнего ключа `sellers_plan_id_fkey`
* **Симптом:** `POST https://sotka-crm.vercel.app/api/sync/sotka` возвращал HTTP 500 с ошибкой:
  `insert or update on table "sellers" violates foreign key constraint "sellers_plan_id_fkey"`.
* **Первопричина:** 
  1. В `sellers_overview` API Sotka возвращает массив строк названий тарифов в поле `item.plans` (например: `["Базовый"]`, `["Премиум"]`, `["Бизнес"]`).
  2. Обработчик `route.ts` конструировал синтетическое значение: `plan_id: item.plans?.[0] ? 'PLN-' + item.plans[0] : null`, что приводило к формированию значений `'PLN-Базовый'`, `'PLN-Премиум'`, `'PLN-Бизнес'`.
  3. В таблице `public.plans` первичные ключи заданы как `PLN-BASE`, `PLN-PREM`, `PLN-CORP`. Значений с кириллическими суффиксами в таблице не существовало, а тариф `PLN-BIZ` («Бизнес») отсутствовал вовсе. При попытке upsert PostgreSQL справедливо блокировал транзакцию из-за несоответствия внешнего ключа `FOREIGN KEY (plan_id) REFERENCES plans(plan_id)`.

### 1.2. Ошибка PostgreSQL 21000 при обработке платежей
* В процессе нагрузочной проверки порций транзакций выявлена потенциальная коллизия `cardinality_violation` (`ON CONFLICT DO UPDATE command cannot affect row a second time`) при наличии повторяющихся записей `payment_id` или `seller_phone` внутри одной пачки от API.

---

## 2. Реализованные решения

### 2.1. Нормализатор `resolveSotkaPlan`
В [`lib/sotka/normalizers.ts`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/SotkaCRM/lib/sotka/normalizers.ts) созданы:
* Таблица стандартных соответствий `STANDARD_PLAN_MAPPINGS`:
  * `'базовый'`, `'base'`, `'basic'` → `PLN-BASE`
  * `'премиум'`, `'premium'`, `'prem'` → `PLN-PREM`
  * `'бизнес'`, `'business'`, `'biz'` → `PLN-BIZ`
  * `'корпоративный'`, `'corporate'`, `'corp'` → `PLN-CORP`
* Функция `resolveSotkaPlan`, сопоставляющая переданный тариф со справочником существующих тарифов в базе данных и валидирующая допустимость `plan_id`.

### 2.2. Архитектура безопасного импорта в `route.ts`
В [`app/api/sync/sotka/route.ts`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/SotkaCRM/app/api/sync/sotka/route.ts):
1. Перед циклом выгрузки продавцов считываются все актуальные тарифы из таблицы `public.plans` и формируется множество валидных `validPlanIds`.
2. Если в порции продавцов обнаружен новый/неизвестный тариф, он предварительно автоматически регистрируется в таблице `plans` с дефолтными параметрами.
3. Добавлен жесткий инвариант безопасности: `safePlanId = resolvedPlanId && validPlanIds.has(resolvedPlanId) ? resolvedPlanId : null`. Значение `plan_id` передается в `sellers` **только** если оно гарантированно существует в `plans`. В противном случае передается `NULL`, сохраняя исходное название тарифа в `sellers.plan_name`.
4. Внедрена внутрибатчевая дедупликация продавцов по `seller_phone` и транзакций по `payment_id`, исключающая ошибку PostgreSQL `21000`.

### 2.3. Добавление тарифа «Бизнес» (`PLN-BIZ`)
* В Supabase Cloud и в миграцию [`supabase/migrations/004_add_biz_plan.sql`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/SotkaCRM/supabase/migrations/004_add_biz_plan.sql) добавлен тариф:
  * ID: `PLN-BIZ`
  * Название: `Бизнес`
  * Стоимость: `7000.00` сом/мес.
* Добавлен в [`supabase/seed.sql`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/SotkaCRM/supabase/seed.sql).

### 2.4. Актуализация спецификаций
* [`DB.md`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/SotkaCRM/DB.md): Раздел 3.10 и Раздел 8 обновлены с описанием 4 тарифов и правил разрешения внешнего ключа.
* [`sotka-api.json`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/SotkaCRM/sotka-api.json): В `normalization_rules` зафиксировано правило `plan_resolution_foreign_key_guard`.

---

## 3. Результаты живого тестирования и сборки

1. **Тест выполнения синхронизации с реальным API Sotka и Supabase:**
   * Продавцов выгружено и сохранено: **15 из 15**
   * Ошибки `sellers_plan_id_fkey`: **0 (Устранена)**
   * Ошибки `cardinality_violation (21000)`: **0 (Устранена)**
   * HTTP-ответ эндпоинта: `200 OK` (`success: true`)

2. **Проверка типов TypeScript:**
   * `npx tsc --noEmit` — 0 ошибок (Код 0).

3. **Продакшн-сборка:**
   * `npm run build` — Успешно скомпилированы 15/15 маршрутов за 14.6s (Код 0).
