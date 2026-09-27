# Декомпозиция и план реализации: Устранение ошибки пакетного Upsert при синхронизации API, включение «Подключений» в Mobile Bottom Bar и строгая изоляция выплат для SMM и Консультантов

**Дата разработки:** 27-09-2026  
**Ветка:** `main`  
**Исполнитель:** DeepMind Antigravity  

---

## 1. Анализ проблемы и постановка задач

### Задача 1. Устранение ошибки пакетного Upsert при синхронизации API продавцов
* **Проблема:** PostgreSQL выбрасывает ошибку `ON CONFLICT DO UPDATE command cannot affect row a second time`, если в одной транзакции/команде `upsert` в массиве встречаются две записи с одинаковым конфликтным ключом (`sotka_id` / `organization_id` / `seller_phone`).
* **Решение:**
  1. В `app/sellers/actions.ts` и `app/api/v1/sellers/sync/route.ts` (а также `app/api/sync/sotka/route.ts`):
     - Внедрить Map-дедупликацию по ключу `sotka_id` (или `organization_id` / `seller_phone`) со слиянием полей (последняя запись перезаписывает предыдущую и обновляет `updated_at`).
     - Гарантировать дедупликацию и по `seller_phone` (PK таблицы `sellers`).
     - Реализовать утилиту разбиения на пакеты (чанкование) по 50 записей (`chunkArray(uniqueSellers, 50)`).
     - Вызывать `.upsert(chunk, { onConflict: 'seller_phone', ignoreDuplicates: false })` (или `onConflict: 'organization_id'` с fallback).
     - Добавить структурированное серверное логирование: количество полученных от API, количество уникальных после дедупликации, число сохраненных.

### Задача 2. Добавление модуля «Подключения» в мобильную нижнюю панель (`MobileBottomBar.tsx`)
* **Конфигурация:**
  - Перевести контейнер на 4-колоночную сетку: `grid grid-cols-4 h-16 safe-area-bottom`.
  - Задать строгий порядок и состав навигации слева направо:
    1. **Лиды** (`/leads`): иконка `<UserCheck className="w-5 h-5" />`, подпись «Лиды».
    2. **Продавцы** (`/sellers`): иконка `<Store className="w-5 h-5" />`, подпись «Продавцы».
    3. **Подключения** (`/connections`): иконка `<Link2 className="w-5 h-5" />`, подпись «Подключения».
    4. **Главная** (`/`): иконка `<LayoutDashboard className="w-5 h-5" />`, подпись «Главная».
  - Подсветка активной вкладки цветом `text-primary` (`text-blue-600 dark:text-blue-400`), неактивных — `text-muted-foreground` (`text-zinc-500 dark:text-zinc-400`).
  - Сохранить корректную изоляцию для роли `smm` (Лиды + Главная/Профиль, так как SMM не имеет доступа к продавцам и подключениям по `GEMINI.md`).

### Задача 3. Строгая изоляция выплат для ролей SMM и Консультантов
* **База данных Supabase:**
  - Создать миграцию `supabase/migrations/016_payouts_isolation_smm_consultant.sql`.
  - Добавить колонку `status VARCHAR(20) NOT NULL DEFAULT 'paid'` в `employee_payouts`.
  - Добавить колонку `employee_id UUID REFERENCES users(user_id)` (синхронизируется с `user_id`).
  - Создать view `public.payouts` (с маппингом `employee_id = user_id`) для полной совместимости.
  - Обновить RLS политику `payouts_select_policy` на `employee_payouts` и `payouts`:
    - Администраторы и руководители (`admin`, `supervisor`) видят все записи.
    - SMM и Консультанты (`smm`, `consultant`) видят ТОЛЬКО свои выплаты (`user_id = current_user_id`) и ТОЛЬКО со статусом `status = 'paid'`.
* **API и Серверный код (`app/api/v1/payouts/route.ts`, `app/payouts/actions.ts`):**
  - Разрешить SMM доступ к `GET /api/v1/payouts` с автоматической фильтрацией по его `user_id` и `status = 'paid'`.
  - Запретить SMM и консультантам запрашивать чужой `userId`.
* **Фронтенд (`app/payouts/page.tsx`, `lib/api/client.ts`):**
  - Адаптировать отображение страницы выплат для ролей SMM и консультантов (скрывать кнопку создания выплаты, показывать только персональные оплаченные выплаты и персональную сводку).
* **Синхронизация документации:**
  - Актуализировать `DB.md` и `public/openapi.json`.

---

## 2. Пошаговый план работ

1. **Шаг 1:** Реализация дедупликации и чанкования по 50 записей в `app/sellers/actions.ts`, `app/api/v1/sellers/sync/route.ts` и `app/api/sync/sotka/route.ts`.
2. **Шаг 2:** Модификация `components/layout/MobileBottomBar.tsx` (4 колонки: Лиды, Продавцы, Подключения, Главная с `Link2` и `safe-area-bottom`).
3. **Шаг 3:** Подготовка и применение миграции `016_payouts_isolation_smm_consultant.sql` в базе Supabase.
4. **Шаг 4:** Доработка серверных эндпоинтов `app/api/v1/payouts/route.ts`, действий `app/payouts/actions.ts` и интерфейса `app/payouts/page.tsx`.
5. **Шаг 5:** Актуализация `DB.md` и `public/openapi.json`.
6. **Шаг 6:** Верификация: `npx tsc --noEmit`, E2E проверочный скрипт `scripts/verify-payouts-isolation.mjs`, `npm run build`.
7. **Шаг 7:** Оформление отчета в `.antigravity/results/` и коммит в репозиторий.
