# Отчет о выполнении Этапа 5: Синхронизация с API api.sotka.kg и реестр продавцов

**Дата и время:** 19-09-2026 01:41:08  
**Статус:** Завершено успешно / Верифицировано  

---

## 1. Реализованный функционал

### 1.1. Сервисный слой взаимодействия с внешним API (`lib/services/sotka-api.ts`)
- `authenticateSotkaAdmin()`: Выполняет POST-запрос на `https://api.sotka.kg/api/public/v1/auth/pair` с учетными данными `SOTKA_API_PHONE` (строго 9 цифр без кода страны), `SOTKA_API_PASSWORD` и `iso_code_id: 1`. Извлекает Bearer-токен сессии (`res.access || res.access_token || res.detail?.access`).
- `logoutSotkaSession(token)`: Выполняет POST-запрос на `https://api.sotka.kg/api/public/v1/auth/logout/`, гарантируя очистку активных сессий на внешнем сервере.
- `fetchSellersOverview(token, offset, limit)`: Запрашивает реестр продавцов (`GET /api/private/v1/admin/sellers-overview/`) с пагинацией `offset`/`limit`. Возвращает список `SotkaSellerItem` и общий `count`.
- `fetchTransactions(token, offset, limit)`: Запрашивает историю транзакций (`GET /api/private/v1/admin/transactions/`) с пагинацией и автоматическим fallback на `/api/private/v1/admin/payments/`.

### 1.2. Серверный Next.js Route Handler (`app/api/sync/sotka/route.ts`)
- **Строгий RBAC:** Доступен исключительно роли `admin` (возврат HTTP `403 Forbidden` для `consultant` и `smm`).
- **Инвариант сохранности кураторов:** Перед выполнением upsert в таблицу `sellers` считываются существующие `manager_id`. При сохранении локально назначенный менеджер гарантированно не затирается.
- **Нормализация телефонов:** Телефоны продавцов приводятся к формату `996XXXXXXXXX` (12 цифр без плюса).
- **Пакетная вставка (Batch Upsert):** Порциями по 100 записей через `supabase.from('sellers').upsert(..., { onConflict: 'seller_phone' })` и `supabase.from('payments').upsert(..., { onConflict: 'payment_id' })`.
- **Гарантированный logout:** Вызов `logoutSotkaSession` обёрнут в блок `finally`.

### 1.3. Пользовательский интерфейс синхронизации (`components/layout/TopHeader.tsx` & `AppLayout.tsx`)
- Кнопка «Синхронизация API» в шапке `TopHeader` отображается только для роли `admin`.
- Анимация спиннера `animate-spin` и блокировка повторных кликов (`disabled={isSyncing}`) во время процесса.
- Сохранение временной метки последней синхронизации в `localStorage` (`crm_last_sotka_sync`) с отображением времени в шапке.
- Всплывающие уведомления `useToast` об успешной синхронизации (число продавцов и платежей) или ошибке.

### 1.4. Первичный реестр продавцов (`/sellers`)
- **Метрики базы продавцов (KPI Cards):** «Всего продавцов», «Активные», «На модерации», «Общий баланс KGS», «С куратором».
- **Интеграция DataJournal:**
  - Десктоп: Табличный вид со sticky-шапкой, сортировкой, фильтрацией и кастомными ячейками.
  - Мобильные: Карточный вид с кнопками связи в 1 клик (`tel:` и `wa.me`).
  - Колонки: Продавец (`seller_name`), Магазин (`store`), Телефон (`seller_phone`), Баланс (`balance`, KGS), Тариф (`plan_name`), Статус модерации (`moderation`), Активность (`is_active`), Точек/Сотрудников, Куратор (`manager_id` / имя).
- **Карточка продавца (`EntityModal`):** Режим просмотра подробных сведений (включая количество торговых точек, сотрудников, бренды, дату регистрации и последнюю активность). Для администратора доступно назначение и изменение куратора из выпадающего списка активных сотрудников.
- **RBAC:** Доступ открыт для `admin` и `consultant`. Для роли `smm` срабатывает редирект на `/leads` с уведомлением об ограничении прав.

---

## 2. Результаты верификации

1. `npx tsc --noEmit` — 0 ошибок типизации.
2. `npm run build` — Успешная компиляция production-сборки Next.js 15:
   - `ƒ /api/sync/sotka` — Dynamic Route Handler.
   - `○ /sellers` — Оптимизированная страница реестра.
