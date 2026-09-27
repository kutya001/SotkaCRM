# Протокол верификации: RBAC продавцов для консультантов, динамическое связывание с лидом и редизайн Mobile Bottom Bar

**Дата:** 27-09-2026 11:23:00  
**Статус:** Успешно верифицировано  
**Коммит / Ветка:** `main`

---

## 1. Внесенные изменения

### 1.1. База данных и RLS (`supabase/migrations/013_consultant_seller_visibility.sql` & `DB.md`)
- В перечисление `user_role` добавлено значение `'supervisor'`.
- Создано представление `public.employees`, проксирующее `public.users` для совместимости внешних ключей.
- Обновлена политика `sellers_select_policy` на таблице `sellers`:
  * Роли `admin` и `supervisor` видят всех продавцов.
  * Роль `consultant` видит исключительно одобренных продавцов (`moderation = 'approved'`).
  * Роли `smm` доступ закрыт.
- Обновлена RPC-функция `get_sellers_kpi_stats()`: консультанты получают расчет KPI строго по одобренным продавцам.
- Миграция успешно применена к live Supabase проекту (`qfsfgthlbjacxyxuvrnr`).
- Документация в `DB.md` актуализирована (раздел 6.2 и раздел 13).

### 1.2. Серверный слой (`app/sellers/actions.ts`)
- В интерфейс `SellersResponse` добавлено поле `hasAvailableLeads?: boolean`.
- Внедрен серверный экшен `checkAvailableLeadsExist(): Promise<boolean>`, проверяющий наличие свободных лидов (`seller_phone IS NULL AND status != 'Отмена'`), с учетом роли консультанта (`assigned_to = profile.user_id`).
- В `getSellers()`:
  * Для роли `consultant` принудительно зафиксирован фильтр `query = query.eq('moderation', 'approved')`, исключающий обход через параметры запроса.
  * Параллельно вычисляется наличие свободных лидов для связывания (`hasAvailableLeads`).
- В `getManagersList()` добавлен фильтр для роли `'supervisor'`.
- В `getAvailableLeadsForSellerLinking()` и `linkSellerToLeadAction()` права расширены для `['admin', 'supervisor', 'consultant']`, с изоляцией по `assigned_to` для консультантов.

### 1.3. Пользовательский интерфейс продавцов (`app/sellers/page.tsx`)
- Добавлено состояние `hasAvailableLeads`, обновляемое при загрузке и связывании продавцов.
- Кнопка «Связать с лидом» динамически скрывается во всех представлениях, если `hasAvailableLeads === false`:
  * В столбце таблицы `columns`
  * В мобильной карточке `renderSellerCard`
  * В контекстном меню строки `DataJournal` (`customRowActions`)
- Для роли `consultant`:
  * Вкладки модерации сокращены до единственной вкладки «Одобрено» (`approved`).
  * Селектор статуса модерации скрыт из всплывающего окна фильтров хедера.

### 1.4. Мобильная навигация (`components/layout/MobileBottomBar.tsx` & `app/globals.css`)
- Нижний бар навигации переработан в сетку из строго **3 кнопок** по центру:
  1. **Лиды** (`/leads`, иконка `UserCheck`, лейбл «Лиды»)
  2. **Главная** (`/`, иконка `LayoutDashboard`, лейбл «Главная»)
  3. **Продавцы** (`/sellers`, иконка `Store`, лейбл «Продавцы»)
- Кнопки «Подключения», «Выплаты» и гамбургер «Меню» удалены из нижнего бара (все разделы доступны через гамбургер в `MobileHeader` -> `MobileMenuDrawer`).
- Для роли `smm` отображаются только 2 кнопки: «Лиды» (`/leads`) и «Профиль» (`/profile`).
- Добавлен CSS-класс `.safe-area-bottom` в `app/globals.css` для корректного отображения на мобильных устройствах с жестовой полосой.
- В `MobileMenuDrawer` и `DesktopSidebar` добавлена поддержка роли `supervisor`.

---

## 2. Результаты верификации

1. **Компиляция TypeScript (`npx tsc --noEmit`):**
   - Выполнено без ошибок (`exit code 0`).
2. **Next.js Production Build (`npm run build`):**
   - Успешная сборка всех 16 статических и динамических маршрутов (`exit code 0`).
   - Маршруты `/sellers`, `/leads`, `/connections`, `/` скомпилированы штатно.
3. **Стандарты UI/UX (`GEMINI.md`, `UxUi.md`):**
   - Lucide React иконки (`stroke-width="1.75"` и `2`).
   - Полное отсутствие эмодзи.
   - Glassmorphism Apple Island styling.
