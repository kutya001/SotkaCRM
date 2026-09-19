# Протокол устранения ошибок favicon.ico (404) и manifest.webmanifest (Syntax error)

- **Дата:** 20-09-2026 00:06:00
- **Сущность:** Статические ассеты, веб-манифест PWA, роутинг middleware
- **Статус:** Исправлено и верифицировано

---

## 1. Диагностика причин

1. **`favicon.ico 404 (Not Found)`**:
   - Браузер запрашивал `/favicon.ico` по умолчанию.
   - В проекте отсутствовал бинарный файл `favicon.ico` (присутствовал только `public/icon.svg`).
   - В метаданных `app/layout.tsx` отсутствовала явная декларация иконок для браузера.
2. **`manifest.webmanifest:1 Manifest: Line: 1, column: 1, Syntax error`**:
   - `middleware.ts`: регулярное выражение `matcher` не исключало `.webmanifest` и `.json`, из-за чего неавторизованные запросы к `/manifest.webmanifest` получали 307-редирект на `/login` (HTML-документ). Парсер браузера получал символ `<` вместо `{`.
   - Конфликт манифестов: в проекте присутствовал файл `public/manifest.json`, а в `app/layout.tsx` была захардкожена ссылка `manifest: '/manifest.json'` параллельно со встроенным механизмом Next.js `app/manifest.ts`.

---

## 2. Реализованные исправления

1. **Генерация `favicon.ico`**:
   - Сгенерирован стандартный 32x32 `.ico` файл со стилизованным логотипом Sotka и размещен в `public/favicon.ico` и `app/favicon.ico`.
2. **Обновление метаданных `app/layout.tsx`**:
   - Удалена жесткая привязка `manifest: '/manifest.json'`. Next.js App Router автоматически генерирует и инжектирует тег `<link rel="manifest" href="/manifest.webmanifest">` на основе `app/manifest.ts`.
   - Настроен блок `icons`:
     ```typescript
     icons: {
       icon: [
         { url: '/favicon.ico', sizes: 'any' },
         { url: '/icon.svg', type: 'image/svg+xml' },
       ],
       shortcut: '/favicon.ico',
       apple: '/icon.svg',
     }
     ```
3. **Обновление `middleware.ts`**:
   - В регулярное выражение `matcher` добавлены исключения для `manifest.webmanifest`, `manifest.json`, `robots.txt`, `sitemap.xml` и расширения `.ico`.
4. **Удаление дублирующего файла**:
   - Удален устаревший `public/manifest.json`.

---

## 3. Верификация

1. **TypeScript (`npx tsc --noEmit`)**: 0 ошибок.
2. **Next.js Production Build (`npm run build`)**: Успешная сборка. Маршрут `/manifest.webmanifest` генерируется статически (`127 B`).
3. **HTTP-тестирование без авторизации (`next start`)**:
   - `GET /manifest.webmanifest`: HTTP 200, Content-Type: `application/manifest+json`, валидный JSON.
   - `GET /favicon.ico`: HTTP 200, Content-Type: `image/x-icon`, размер: 766 байт.
