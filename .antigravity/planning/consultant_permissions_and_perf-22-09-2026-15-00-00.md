# Архитектурный план: Настройка прав роли Консультант и ускорение приложения

**Дата:** 22-09-2026 15:00:00  
**Автор:** Antigravity  

## 1. Контекст задачи
- **Запрос пользователя:** 
  1. «Консультант должен иметь доступ только к продавцам а именно если эти продавцы еще не назначены или назначены на него».
  2. «Не должен иметь возможность добавлять лиды».
  3. «Ускорь приложение».

## 2. Архитектурные изменения
1. **СУБД (PostgreSQL / Supabase):**
   - RLS-политика `leads_insert_policy`: убрать роль `consultant` из `WITH CHECK`, оставить строго `admin` и `smm`.
   - RPC `get_sellers_kpi_stats()`: для `consultant` считать продавцов `WHERE manager_id = v_user_uuid OR manager_id IS NULL`.
   - RPC `get_analytics_summary()`: для `consultant` считать продавцов `WHERE manager_id = v_user_uuid OR manager_id IS NULL`.
   - B-Tree индексы:
     - `idx_sellers_manager_synced` ON `sellers (manager_id, synced_at DESC)`
     - `idx_sellers_unassigned_synced` ON `sellers (synced_at DESC) WHERE manager_id IS NULL`
2. **Серверные экшены:**
   - `createLead` (`app/leads/actions.ts`): блокировка вызова для роли `consultant`.
   - `getSellers` (`app/sellers/actions.ts`): фильтрация `manager_id.is.null,manager_id.eq.${profile.user_id}` для роли `consultant`.
   - `lib/auth/check-role.ts`: мемоизация и чтение `user.app_metadata` без повторного SELECT к `users`.
3. **Клиентский рендеринг (DOM & UI):**
   - Скрытие FAB и кнопки добавления лида для консультанта в `app/leads/page.tsx` и `components/layout/AppLayout.tsx`.
   - В `app/sellers/page.tsx` — ограничение списка кураторов в фильтре для консультанта («Все доступные», «Мои», «Свободные»).
   - Мемоизация определений `columns` через `React.useMemo` на страницах `leads`, `sellers`, `connections`, `payouts` для исключения пересоздания структуры таблицы и сброса виртуализации.
   - Оптимизация `pageSize` до 50 записей по умолчанию.
