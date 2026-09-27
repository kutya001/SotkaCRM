# План: Ограничение доступа к Swagger Docs (только Admin), перенос кнопки в профиль и релокация профиля в Top/Mobile Header

**Дата:** 27-09-2026 11:41:00  
**Ветка:** `main`

---

## 1. Цель
Реорганизация точек входа в профиль и Swagger-документацию:
1. Защита маршрута `/docs` строго для роли `admin` на уровне серверного рендеринга и middleware.
2. Встраивание ссылки на Swagger-документацию в `/profile` только для администратора.
3. Удаление ссылок на `/profile` из основных списков сайдбара и меню-шторки.
4. Вынос интерактивной точки входа в Профиль в правый блок `TopHeader` (десктоп) и `MobileHeader` (смартфон, крайняя правая кнопка после переключателя темы).

---

## 2. Декомпозиция задач

### 2.1. Серверная защита `/docs` (`app/docs/page.tsx` и `lib/supabase/middleware.ts`)
- В `app/docs/page.tsx`:
  * Серверная проверка через `createClient()` и таблицу `employees` (`SELECT role FROM employees WHERE auth_id = user.id OR user_id = user.id LIMIT 1`).
  * При отсутствии сессии или `role !== 'admin'` вызывать `redirect('/')`.
  * Рендерить `<SwaggerDocs url="/openapi.json" />` только для администратора.
- В `lib/supabase/middleware.ts`:
  * Удалить `/docs` из открытых исключений `isDocsPage`. Неавторизованный пользователь при попытке зайти на `/docs` перенаправляется на `/login`.

### 2.2. Кнопка «Документация API» в профиле (`app/profile/page.tsx`)
- Определить текущую роль пользователя (`user.role`).
- При `role === 'admin'` отображать блок ссылки на `/docs` со стилизацией Apple Island / Glassmorphism и контурными иконками Lucide React (`BookOpen`, `ArrowUpRight`).
- Для ролей `consultant` и `supervisor` данный блок скрывать.

### 2.3. Очистка меню от дублирующего «Профиля»
- В `components/layout/DesktopSidebar.tsx`:
  * Убрать переход на `/profile` из сайдбара (оставить только отображение информации о пользователе и кнопку выхода).
- В `components/layout/MobileMenuDrawer.tsx`:
  * Удалить пункт `Профиль` из массива `ALL_NAV_ITEMS`.

### 2.4. Релокация Профиля в TopHeader и MobileHeader
- В `components/layout/TopHeader.tsx`:
  * Обернуть блок профиля пользователя в правом углу в `<Link href="/profile">` с ховер-эффектом и стилями Apple Island.
- В `components/layout/MobileHeader.tsx`:
  * В правом блоке выстроить строгий порядок:
    1. Поиск (`Search`)
    2. Переключатель темы (`ThemeToggle`)
    3. Кнопка профиля (`Link href="/profile"` с аватаром/инициалами, `w-8 h-8 rounded-full`)

### 2.5. Верификация и сборка
- Проверка типов: `npx tsc --noEmit`.
- Сборка: `npm run build`.
- Создание отчета результатов: `.antigravity/results/admin_docs_rbad_and_profile_header_relocation_verified-27-09-2026-11-xx-xx.md`.
- Фиксация в git.
