# План реализации: Hardening продакшн-контура SotkaCRM (Rate Limiting, Server-Timing, E2E-цепочка)

**Дата составления:** 27-09-2026 12:18:00  
**Цель:** Защита системы от брутфорса и перегрузок (Rate Limiting), сквозной мониторинг задержек (Server-Timing, Slow API warnings), E2E-верификация бизнес-цепочки и актуализация OpenAPI 3.0.3.

---

## 1. Архитектура Rate Limiting (`lib/api/rate-limit.ts`)

### 1.1 Алгоритм и модель хранения
- **Алгоритм:** Sliding Window Counter (скользящее временное окно).
- **Хранилище:**
  - In-memory Map с периодической очисткой (TTL) устаревших записей, оптимизированная для serverless/edge сред.
  - Поддержка Upstash Redis REST API при наличии переменных окружения `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`. Если переменные не заданы — прозрачный fallback на локальное in-memory хранилище без падения приложения.
- **Идентификация клиента:**
  - `x-forwarded-for` (первый IP в цепочке) -> `x-real-ip` -> `cf-connecting-ip` -> fallback `'127.0.0.1'`.
  - Для авторизованных запросов: комбинированный ключ `ip:user_id`.

### 1.2 Политики лимитирования
1. **Аутентификация (`/api/v1/auth/login`):**
   - Лимит: **5 запросов в минуту** на IP (защита от перебора паролей).
2. **Внешние вебхуки и шлюз (`/api/sync/sotka`):**
   - Лимит: **30 запросов в минуту** на IP / API-ключ.
3. **Общий контур REST API (`/api/v1/*`):**
   - Лимит: **120 запросов в минуту** на пользователя / IP.

### 1.3 Ответ при превышении лимита (HTTP 429 Too Many Requests)
- Заголовки:
  - `Retry-After: <секунды до сброса>`
  - `X-RateLimit-Limit: <лимит>`
  - `X-RateLimit-Remaining: 0`
  - `X-RateLimit-Reset: <unix timestamp>`
- JSON-тело:
  ```json
  {
    "error": "Слишком много запросов. Пожалуйста, подождите перед повторной попыткой.",
    "code": "RATE_LIMIT_EXCEEDED",
    "retry_after": 60
  }
  ```

---

## 2. Сквозное измерение задержек и заголовок Server-Timing

### 2.1 Интеграция в `middleware.ts`
- Фиксация начального времени через `performance.now()`.
- Выполнение цепочки проверок (Rate Limiting -> Supabase Session).
- Передача запроса в обработчик.
- Установка заголовка `Server-Timing`:
  ```http
  Server-Timing: app;dur=45.2;desc="Application Processing", total;dur=48.6
  ```
- Логирование медленных запросов:
  - Если `totalDur > 500ms`, вывод предупреждения:
    `[SLOW API] ${method} ${pathname} took ${dur.toFixed(1)}ms | User: ${userId || 'anon'}`

### 2.2 Поддержка в клиентском SDK (`lib/api/client.ts`)
- Чтение заголовка `Server-Timing` в `fetch` перехватчике.
- В режиме разработки (`process.env.NODE_ENV !== 'production'`) вывод информации о времени ответа сервера в консоль браузера:
  `[API SDK] ${method} ${url} | Server-Timing: ${serverTiming}`

---

## 3. Интеграция в эндпоинты

- `app/api/v1/auth/login/route.ts` — проверка лимита логина и простановка заголовков.
- `app/api/sync/sotka/route.ts` — проверка лимита вебхука и заголовок `Server-Timing`.
- `lib/api/handler.ts` — поддержка проброса заголовков `Server-Timing` и `X-RateLimit-*` в `apiSuccess` и `apiError`.

---

## 4. E2E-верификация сквозных сценариев

Скриптовая и программная проверка цепочки:
1. `POST /api/v1/leads` -> создание лида со статусом `Открыт`.
2. `POST /api/v1/leads/{id}/link-seller` -> связывание с продавцом, перевод в `Подписан`.
3. `GET /api/v1/connections` -> проверка наличия записи со статусом `новый`/`подключен`.
4. `POST /api/v1/payouts/calculate` -> расчет вознаграждения по ставке консультанта.
5. Проверка реактивного обновления клиентских интерфейсов без F5.

---

## 5. Обновление документации OpenAPI (`public/openapi.json`)

- Добавление схемы `RateLimitErrorResponse` в `components.schemas`.
- Добавление описания ответа `429 Too Many Requests` и заголовков `Server-Timing`, `Retry-After`, `X-RateLimit-*` для `POST /api/v1/auth/login` и `POST /api/sync/sotka`.
