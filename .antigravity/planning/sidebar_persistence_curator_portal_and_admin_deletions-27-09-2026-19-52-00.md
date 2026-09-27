# Архитектурный план: Устранение сбоя Server Action, фиксация свернутости сайдбара, Portal для селектора кураторов и каскадные удаления подключений/выплат

**Дата создания:** 27-09-2026 19:52:00
**Статус:** Планирование и декомпозиция задач

---

## 1. Анализ проблемы и цели

1. **Обработка ответов API в `lib/api/client.ts`:**
   - Предотвратить сбой `An unexpected response was received from the server` или Unhandled Promise Rejection при не-JSON ответах, кодах 204 No Content, пустых телах ответов или HTML-страницах ошибок.
   - Проверять заголовок `content-type` перед `response.json()`.
   - В Route Handlers возвращать гарантированно `NextResponse.json` даже при внутренних ошибках с кодами 401, 403, 404, 500.

2. **Персистентность сайдбара (`sotka_sidebar_collapsed`):**
   - В `components/layout/AppLayout.tsx` и `components/layout/DesktopSidebar.tsx` привязать состояние `isCollapsed` к `localStorage.getItem('sotka_sidebar_collapsed')`.
   - Избежать расхождений гидратации (hydration mismatch) при серверном рендеринге через `useEffect` инициализацию.

3. **React Portal для `CuratorSelectDropdown.tsx`:**
   - Сейчас меню позиционируется абсолютно внутри ячейки таблицы и обрезается контекстом наложения `<tr>` / `overflow` контейнера `DataJournal`.
   - Решение: `createPortal(..., document.body)` с вычислением экранных координат `getBoundingClientRect()`, фиксированным `z-[99999]`, проверкой высоты окна `window.innerHeight` (открытие вверх, если внизу не помещается), слушателями `scroll`/`resize`/`Escape` и закрытия по клику вне.

4. **Удаление подключения (Admin Only) с каскадным сбросом:**
   - `DELETE /api/v1/connections/[id]`:
     - Проверка роли `admin`.
     - Найти `seller_phone` / `seller_id` подключения.
     - `UPDATE sellers SET manager_id = NULL, updated_at = NOW() WHERE seller_phone = ...` (или `organization_id`).
     - `DELETE FROM connection_accruals WHERE connection_id = id;`
     - `DELETE FROM connections WHERE connection_id = id;`
   - В `app/connections/page.tsx`:
     - Добавить действие «Удалить подключение» в ПКМ и карточку (только для `admin`).
     - Инвалидация кэшей `connections` и `sellers`.

5. **Удаление выплаты (Admin Only) с разблокировкой начислений:**
   - `DELETE /api/v1/payouts/[id]`:
     - Проверка роли `admin`.
     - `UPDATE connection_accruals SET is_paid = false, payout_id = NULL, paid_at = NULL WHERE payout_id = id;`
     - `DELETE FROM employee_payouts WHERE payout_id = id;`
   - В `app/payouts/page.tsx`:
     - Добавить пункт «Удалить выплату» в ПКМ для `admin`.
     - Инвалидация кэшей `payouts` и `connections`.

---

## 2. Пошаговый план внедрения

1. **Шаг 1:** Обновление `lib/api/client.ts` (безопасный парсинг `content-type`, обработка 204 и сетевых ошибок).
2. **Шаг 2:** Проверка базовой утилиты `lib/api/handler.ts` (`handleApiError`) и Route Handlers.
3. **Шаг 3:** Реализация персистентного `isCollapsed` в `components/layout/DesktopSidebar.tsx` и `components/layout/AppLayout.tsx`.
4. **Шаг 4:** Рефакторинг `components/sellers/CuratorSelectDropdown.tsx` с переводом выпадающего списка на `createPortal(..., document.body)`.
5. **Шаг 5:** Обновление `app/api/v1/connections/[id]/route.ts` (каскадный сброс куратора у продавца + удаление начислений + удаление подключения) и добавление удаления в `app/connections/page.tsx`.
6. **Шаг 6:** Обновление `app/api/v1/payouts/[id]/route.ts` (сброс `is_paid = false` в `connection_accruals` + удаление выплаты) и добавление удаления в `app/payouts/page.tsx`.
7. **Шаг 7:** Обновление `public/openapi.json` и `DB.md`.
8. **Шаг 8:** Верификация скриптами, `npx tsc --noEmit` и `npm run build`.
9. **Шаг 9:** Фиксация отчета в `.antigravity/results/`.
