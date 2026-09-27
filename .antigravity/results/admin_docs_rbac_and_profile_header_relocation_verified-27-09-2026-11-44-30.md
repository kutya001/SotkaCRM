# Протокол верификации: Ограничение доступа к Swagger Docs (только Admin), перенос кнопки в профиль и релокация профиля в Top/Mobile Header

**Дата и время:** 27-09-2026 11:44:30  
**Статус:** Выполнено успешно (Verified)

---

## 1. Выполненные задачи и архитектурные изменения

### 1.1. Серверная защита Swagger Docs (`/docs`) только для роли `admin`
* **Файл:** `app/docs/page.tsx`
  - Преобразован в асинхронный серверный компонент (`Server Component`).
  - Извлекает текущую сессию через `createClient()` из `lib/supabase/server.ts`.
  - При отсутствии авторизации выполняет `redirect('/login')`.
  - Запрашивает роль сотрудника из таблицы/представления `employees` (`role === 'admin'`). При несовпадении выполняет `redirect('/')`.
* **Файл:** `lib/supabase/middleware.ts`
  - Добавлен префикс `/docs` в правило строгой RBAC-проверки роли администратора:
    ```typescript
    if ((pathname.startsWith('/admin') || pathname.startsWith('/plans') || pathname.startsWith('/docs')) && role !== 'admin') {
      return createRedirectWithCookies(url, supabaseResponse);
    }
    ```
  - Исключен обход авторизации для `/docs`.
  - Спецификация `/openapi.json` сохранена доступной для внешних инструментов и Swagger UI.

### 1.2. Виджет документации API в профиле пользователя
* **Файл:** `app/profile/page.tsx`
  - Импортированы векторные иконки `BookOpen` и `ArrowUpRight` из `lucide-react`.
  - Размещен стилизованный интерактивный виджет перехода к Swagger UI (`/docs`), отображаемый строго при `currentUserRole === 'admin'`.
  - Для ролей `consultant` и `supervisor` данный виджет полностью скрыт.

### 1.3. Исключение «Профиль» из меню-списков навигации
* **Файл:** `components/layout/DesktopSidebar.tsx`
  - В футере сайдбара удалена обертка `<Link href="/profile">` в развернутом и свернутом состояниях. Теперь сайдбар отображает информацию о пользователе и кнопку выхода без перехода в профиль.
* **Файл:** `components/layout/MobileMenuDrawer.tsx`
  - Из массива `ALL_NAV_ITEMS` удален пункт `Профиль` (`/profile`).

### 1.4. Релокация точки входа в Профиль в заголовки (TopHeader & MobileHeader)
* **Файл:** `components/layout/TopHeader.tsx` (Desktop):
  - Блок пользователя (Имя + Роль + Аватарка) обернут в единый интерактивный `<Link href="/profile">` с ховер-эффектами `hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-xl p-1.5 transition-colors cursor-pointer group`.
  - Добавлен маппинг ролей `ROLE_LABELS` для наглядного отображения роли сотрудника.
* **Файл:** `components/layout/MobileHeader.tsx` (Mobile):
  - Подключен хук `useUser` для получения инициалов пользователя.
  - Кнопка профиля с инициалами или иконкой `User` размещена **крайним правым элементом** в хедере:
    `[Поиск] -> [Фильтры] -> [Тема оформления] -> [Аватар профиля]`.

---

## 2. Результаты статической и сборочной верификации
* `npx tsc --noEmit` — 0 ошибок (Clean).
* `npm run build` — Сборка прошла успешно, все страницы и маршруты сгенерированы штатно.
