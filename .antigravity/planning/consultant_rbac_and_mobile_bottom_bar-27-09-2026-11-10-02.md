# План разработки: RBAC продавцов для консультантов, динамическая кнопка связывания с лидом и редизайн Mobile Bottom Bar

**Дата:** 27-09-2026 11:10:02  
**Целевые файлы:**
- `supabase/migrations/013_consultant_seller_visibility.sql`
- `DB.md`
- `lib/auth/check-role.ts`
- `app/sellers/actions.ts`
- `app/sellers/page.tsx`
- `components/layout/MobileBottomBar.tsx`
- `components/layout/MobileHeader.tsx`
- `components/layout/MobileMenuDrawer.tsx`
- `components/ui/DataJournal.tsx`

---

## 1. Декомпозиция задач

### 1. RLS и изоляция базы продавцов для роли Консультант (`consultant`)
- Создать миграцию `supabase/migrations/013_consultant_seller_visibility.sql`:
  - Добавить значение `supervisor` в `user_role` (`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor'`).
  - Создать view `public.employees` как алиас к `public.users` для совместимости.
  - Обновить политику RLS `sellers_select_policy` на таблице `sellers`:
    - Роли `admin` и `supervisor` видят продавцов с любыми статусами модерации (`approved`, `pending`, `rejected`, `blocked`).
    - Роль `consultant` видит **строго и только** продавцов со статусом `moderation = 'approved'`.
  - Применить миграцию на живую базу Supabase через MCP `execute_sql`.
  - Актуализировать манифест `DB.md`.
- В `app/sellers/actions.ts`:
  - В `getSellers()`: при роли `consultant` накладывать принудительный фильтр `.eq('moderation', 'approved')`.
  - В `getSellersStats()`: для роли `consultant` исключать из подсчета счетчики модерации или возвращать только одобренных.
- В `app/sellers/page.tsx`:
  - Для роли `consultant` скрыть табы «На модерации», «Отклонен», «Заблокирован» и отображать только таб «Одобрено» (`approved`).
  - В выпадающей шторке фильтров TopHeader / MobileHeader для консультанта скрыть выбор статуса модерации.

### 2. Динамическое скрытие кнопки «Связать с лидом» при отсутствии свободных лидов
- В `app/sellers/actions.ts`:
  - Реализовать Server Action `checkAvailableLeadsExist(): Promise<boolean>`:
    - Выполняет легковесный запрос к `leads` с `.is('seller_phone', null).neq('status', 'Отмена').limit(1)`.
    - Для роли `consultant` дополнительно фильтрует по `.eq('assigned_to', profile.user_id)`.
    - Возвращает `true`, если найден хотя бы один подходящий лид, иначе `false`.
  - Интегрировать `hasAvailableLeads` в ответ `getSellers()`.
- В `app/sellers/page.tsx`:
  - Хранить состояние `hasAvailableLeads: boolean`.
  - Если `hasAvailableLeads === false`:
    - Не рендерить кнопку «Связать с лидом» в ячейке таблицы (`renderCell`).
    - Не рендерить кнопку связывания на карточках продавцов (`renderSellerCard`).
    - Не отображать пункт связывания в контекстном меню строки (`customRowActions`).

### 3. Редизайн нижней панели мобильной версии (`MobileBottomBar.tsx`)
- Перевести нижнюю навигационную панель на сетку из **ровно трех кнопок**:
  1. **Лиды** (`/leads`): иконка `<UserCheck className="w-5 h-5" />`, подпись «Лиды».
  2. **Главная** (`/`): иконка `<LayoutDashboard className="w-5 h-5" />`, подпись «Главная».
  3. **Продавцы** (`/sellers`): иконка `<Store className="w-5 h-5" />`, подпись «Продавцы».
- Удалить из нижней панели ссылки на «Подключения» (`/connections`), «Выплаты» (`/payouts`) и кнопку «Меню».
- Стилизация:
  - `lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 grid grid-cols-3 h-16 safe-area-bottom px-2 shadow-lg`.
  - Добавить класс `.safe-area-bottom` в `app/globals.css`.
  - Центральная кнопка «Главная» идеально сбалансирована во второй колонке сетки.

### 4. Мобильное меню (`MobileHeader.tsx` & `MobileMenuDrawer.tsx`)
- Убедиться в корректной работе кнопки гамбургера в `MobileHeader.tsx`.
- Проверить наличие полного перечня разделов в `MobileMenuDrawer.tsx`:
  - Главная (`/`), Лиды (`/leads`), Продавцы (`/sellers`), Подключения (`/connections`), Выплаты (`/payouts`), Сотрудники (`/employees`, скрыто для консультанта), Тарифы (`/plans`), Аналитика (`/analytics`), Профиль (`/profile`), ThemeToggle, LogOut.

---

## 2. Верификация
1. Тест компиляции TypeScript: `npx tsc --noEmit`.
2. Тест сборки Next.js: `npm run build`.
3. Составление протокола верификации в `.antigravity/results/`.
4. Git commit и push в репозиторий.
