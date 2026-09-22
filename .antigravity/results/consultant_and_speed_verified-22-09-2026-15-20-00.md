# Отчет о верификации: Разграничение прав роли Консультант и ускорение работы платформы

**Дата и время проверки:** 22.09.2026 15:20:00 (UTC+6)  
**Статус проверки:** УСПЕШНО (TypeScript 0 errors, Next.js 16/16 routes compiled)

---

## 1. Выполненные задачи и изменения

### 1.1. База данных и RLS (Миграция 010)
- **Файл миграции:** `supabase/migrations/010_consultant_permissions_and_indexes.sql` (применена в базу данных).
- **Исключение роли `consultant` из создания лидов:**
  - Обновлена политика `leads_insert_policy` на таблице `leads`: вставка разрешена только ролям `admin` и `smm` (`created_by = current_crm_user_id()`).
- **Синхронизация расширенных метаданных:**
  - Триггер `sync_user_app_metadata()` теперь сохраняет `full_name`, `role` и `user_id` в `auth.users.raw_app_meta_data`.
- **Доступ консультанта к продавцам:**
  - В RPC `get_sellers_kpi_stats()` и `get_analytics_summary()` для роли `consultant` расчет метрик расширен до `manager_id = v_user_uuid OR manager_id IS NULL`.
- **Специализированные частичные и составные индексы:**
  - `idx_sellers_manager_synced` на `sellers(manager_id, synced_at DESC)`
  - `idx_sellers_unassigned_synced` на `sellers(synced_at DESC) WHERE manager_id IS NULL`

### 1.2. Серверный слой (Server Actions & Auth)
- **`lib/auth/check-role.ts`:**
  - Внедрен Fast-path в `requireAuth()`: извлечение `role`, `user_id`, `full_name` напрямую из `user.app_metadata` без повторного обращения к таблице `users`.
- **`app/leads/actions.ts`:**
  - В `createLead`: добавлена строгая серверная проверка `if (profile.role === 'consultant') return { success: false, error: 'Консультанты не имеют прав на добавление лидов' }`.
  - В `getLeads`, `getConsultantsList`, `getLeadsStats`: внедрен `requireAuth()` взамен прямого `createClient()`.
- **`app/sellers/actions.ts`:**
  - В `getSellers`: для роли `consultant` реализована строгая выборка продавцов `manager_id.is.null,manager_id.eq.${profile.user_id}` (с поддержкой фильтров «Мои продавцы» и «Свободные»).
  - В `getSellers`, `getSellersStats`, `getManagersList`: внедрен `requireAuth()`.
- **`app/connections/actions.ts`:**
  - В `getConnections` и `getConnectionsStats`: внедрен `requireAuth()`.

### 1.3. Клиентский интерфейс (UI & Performance)
- **`components/layout/AppLayout.tsx`:**
  - Для роли `consultant` полностью скрыты мобильная FAB-кнопка и десктопная кнопка добавления `+`.
  - Обработчик `handleFabClick` заблокирован для консультанта.
- **`app/leads/page.tsx`:**
  - `onCreateClick` отключен для роли `consultant`.
  - Параметр URL `?action=create` игнорируется для консультанта.
  - Массив колонок `columns` обернут в `React.useMemo`, устраняя паразитные перерендеры виртуализатора `DataJournal`.
- **`app/sellers/page.tsx`:**
  - Массив колонок `columns` обернут в `React.useMemo`.
  - В `filterContent` для роли `consultant` выпадающий список кураторов заменен на безопасные опции: «Все доступные», «Мои продавцы» и «Свободные (без куратора)».
  - Размер загружаемой страницы уменьшен со 100 до 50 записей.
- **`app/connections/page.tsx` и `app/payouts/page.tsx`:**
  - Массивы `columns` обернуты в `React.useMemo`.
  - Размеры начальных выборок уменьшены со 100 до 50 записей.

---

## 2. Результаты компиляции и сборки

```text
> next build
   ▲ Next.js 15.5.25
   - Environments: .env.local

   Creating an optimized production build ...
 ✓ Compiled successfully in 18.0s
   Linting and checking validity of types ...
   Collecting page data ...
   Generating static pages (16/16) ...
 ✓ Generating static pages (16/16)
   Finalizing page optimization ...

Route (app)                                 Size  First Load JS
┌ ƒ /                                    4.43 kB         190 kB
├ ƒ /analytics                           2.89 kB         189 kB
├ ƒ /connections                         8.72 kB         210 kB
├ ƒ /employees                           8.92 kB         211 kB
├ ƒ /leads                               13.4 kB         221 kB
├ ƒ /payouts                             5.79 kB         207 kB
├ ƒ /plans                               6.63 kB         208 kB
├ ƒ /profile                             8.77 kB         195 kB
├ ƒ /rates                                 130 B         103 kB
└ ƒ /sellers                             8.64 kB         216 kB
```

TypeScript `npx tsc --noEmit`: 0 ошибок.
Next.js Production Build: 16/16 маршрутов скомпилированы успешно.
