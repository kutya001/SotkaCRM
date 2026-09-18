# Этап 1: Архитектурный план и декомпозиция реализации

**Дата и время формирования:** 19-09-2026 00:42:32  
**Статус:** Выполнение (Execution)  
**Этап ТЗ:** 1 — Инициализация репозитория, настройка Supabase, авторизация, лейаут.

---

## 1. Задачи Этапа 1

1. **Инициализация кодовой базы:**
   - Настройка `package.json` со всеми зависимостями (Next.js 15, React 19, Lucide React, Supabase SSR, Tailwind CSS, clsx, tailwind-merge, next-themes).
   - Конфигурация TypeScript (`tsconfig.json`), Next.js (`next.config.ts`), Tailwind CSS (`tailwind.config.ts`, `postcss.config.mjs`).
   - Инициализация `.gitignore`.

2. **База данных и миграции (Supabase / PostgreSQL):**
   - Формирование `supabase/migrations/001_initial_schema.sql` на основе `DB.md`:
     - 6 ENUM типов: `user_role`, `lead_status`, `client_lifecycle_status`, `maintenance_status`, `payout_category_type`, `seller_moderation_status`.
     - 11 таблиц: `users`, `leads`, `sellers`, `payments`, `connections`, `employee_rates`, `client_maintenance`, `employee_payouts`, `outlets`, `plans`, `plans_history`.
     - 12 индексов.
     - Триггеры `prevent_lead_delete`, `audit_plan_price_trigger`, `validate_lead_seller_link_trigger`.
     - Функции `get_current_user_role()`, `get_current_crm_user_id()`.
     - Row Level Security (RLS) политики.
   - Генерация полной строгой схемы типов `types/database.types.ts`.

3. **Слой авторизации и клиенты Supabase:**
   - Клиент браузера: `lib/supabase/client.ts`.
   - Клиент сервера: `lib/supabase/server.ts`.
   - Сервисный клиент администратора: `lib/supabase/admin.ts`.
   - Middleware для обновления JWT-токенов сессий и защиты роутов: `middleware.ts`.
   - Экран входа: `/login` (Glassmorphism, адаптивный вид, обработка ошибок).

4. **Интерфейс и дизайн-система Apple Island (UxUi.md):**
   - Глобальные стили `globals.css` (стеклянные токены, темная и светлая темы, переменные).
   - Провайдер тем: `components/theme/ThemeProvider.tsx`, `components/theme/ThemeToggle.tsx`.
   - Десктопный матовый сайдбар со сворачиванием (`w-64` / `w-18`): `components/layout/DesktopSidebar.tsx`.
   - Верхний плавающий Top Header: `components/layout/TopHeader.tsx`.
   - Мобильный верхний бар с кнопками «Лупа» (раскрывающийся поиск) и «Фильтр»: `components/layout/MobileHeader.tsx`.
   - Мобильный нижний бар Bottom Bar: `components/layout/MobileBottomBar.tsx`.
   - Круглая кнопка FAB (`w-14 h-14`): `components/layout/FAB.tsx`.
   - Корневой лейаут `components/layout/AppLayout.tsx` и `app/layout.tsx`.
   - Стартовая панель дашборда: `app/page.tsx`.

5. **Верификация:**
   - Тестирование компиляции TypeScript и сборки.
   - Формирование отчета в `.antigravity/results/stage1_completed-[ДД-ММ-ГГГГ]-[ЧЧ-ММ-СС].md`.
