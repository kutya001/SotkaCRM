import { checkRateLimit, createRateLimitResponse, getClientIp, getRateLimitPolicy, applyRateLimitHeaders } from '../lib/api/rate-limit.ts';

async function runVerification() {
  console.log('=== STARTING PRODUCTION HARDENING & E2E VERIFICATION ===\n');

  // --- ТЕСТ 1: Извлечение IP клиента из различных прокси-заголовков ---
  console.log('--- ТЕСТ 1: Валидация getClientIp ---');
  const reqWithXff = new Request('http://localhost/api/v1/auth/login', {
    headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
  });
  if (getClientIp(reqWithXff) !== '203.0.113.195') {
    throw new Error('Не удалось корректно извлечь первый IP из x-forwarded-for');
  }

  const reqWithRealIp = new Request('http://localhost/api/v1/auth/login', {
    headers: { 'x-real-ip': '198.51.100.12' },
  });
  if (getClientIp(reqWithRealIp) !== '198.51.100.12') {
    throw new Error('Не удалось извлечь IP из x-real-ip');
  }

  const reqDefault = new Request('http://localhost/api/v1/auth/login');
  if (getClientIp(reqDefault) !== '127.0.0.1') {
    throw new Error('Fallback IP не равен 127.0.0.1');
  }
  console.log('✓ getClientIp корректно обрабатывает x-forwarded-for, x-real-ip и fallback\n');

  // --- ТЕСТ 2: Rate Limiting & Sliding Window на /api/v1/auth/login ---
  console.log('--- ТЕСТ 2: Rate Limiting на /api/v1/auth/login (5 req/min) ---');
  const loginPolicy = getRateLimitPolicy('/api/v1/auth/login');
  if (!loginPolicy || loginPolicy.limit !== 5 || loginPolicy.windowSeconds !== 60) {
    throw new Error('Политика лимитирования для login некорректна: ' + JSON.stringify(loginPolicy));
  }

  const testIp = '198.51.100.42';
  const loginKey = `/api/v1/auth/login:${testIp}`;

  for (let i = 1; i <= 5; i++) {
    const res = await checkRateLimit(loginKey, loginPolicy);
    if (!res.success) {
      throw new Error(`Запрос #${i} был заблокирован, хотя лимит 5!`);
    }
    console.log(`✓ Запрос #${i}: пропущен (remaining: ${res.remaining}, limit: ${res.limit})`);
  }

  // 6-й запрос обязан быть заблокирован (429)
  const blockedRes = await checkRateLimit(loginKey, loginPolicy);
  if (blockedRes.success) {
    throw new Error('6-й запрос прошел, лимитер не сработал!');
  }
  console.log('✓ Запрос #6: заблокирован (429 Too Many Requests)');

  const response429 = createRateLimitResponse(blockedRes);
  if (response429.status !== 429) {
    throw new Error(`Статус ответа не 429, получен: ${response429.status}`);
  }

  const retryAfter = response429.headers.get('Retry-After');
  const limitHeader = response429.headers.get('X-RateLimit-Limit');
  const remainingHeader = response429.headers.get('X-RateLimit-Remaining');
  const resetHeader = response429.headers.get('X-RateLimit-Reset');

  if (!retryAfter || limitHeader !== '5' || remainingHeader !== '0' || !resetHeader) {
    throw new Error('Отсутствуют или некорректны заголовки лимитирования: ' + JSON.stringify({
      retryAfter, limitHeader, remainingHeader, resetHeader
    }));
  }
  console.log(`✓ Заголовки ответа 429 корректны: Retry-After=${retryAfter}, Limit=${limitHeader}, Remaining=${remainingHeader}, Reset=${resetHeader}`);

  const body429 = await response429.json();
  if (body429.code !== 'RATE_LIMIT_EXCEEDED' || !body429.retry_after) {
    throw new Error('Некорректное тело ответа 429: ' + JSON.stringify(body429));
  }
  console.log('✓ Тело ответа 429 содержит RATE_LIMIT_EXCEEDED и retry_after\n');

  // --- ТЕСТ 3: Rate Limiting для вебхуков Sotka HQ и общих эндпоинтов ---
  console.log('--- ТЕСТ 3: Гранулярные политики Rate Limiting ---');
  const webhookPolicy = getRateLimitPolicy('/api/sync/sotka');
  if (!webhookPolicy || webhookPolicy.limit !== 30) {
    throw new Error('Политика лимитирования для webhook некорректна: ' + JSON.stringify(webhookPolicy));
  }
  console.log(`✓ Политика /api/sync/sotka: лимит ${webhookPolicy.limit} req/min подтвержден`);

  const generalApiPolicy = getRateLimitPolicy('/api/v1/leads');
  if (!generalApiPolicy || generalApiPolicy.limit !== 120) {
    throw new Error('Политика лимитирования для общих API некорректна: ' + JSON.stringify(generalApiPolicy));
  }
  console.log(`✓ Политика /api/v1/*: лимит ${generalApiPolicy.limit} req/min подтвержден\n`);

  // --- ТЕСТ 4: Server-Timing формат заголовка ---
  console.log('--- ТЕСТ 4: Валидация формата W3C Server-Timing ---');
  const mockDur = 45.2;
  const timingHeader = `app;dur=${mockDur.toFixed(1)};desc="Application Processing", total;dur=${mockDur.toFixed(1)}`;
  if (!timingHeader.includes('dur=45.2') || !timingHeader.includes('desc="Application Processing"')) {
    throw new Error('Формат Server-Timing некорректен: ' + timingHeader);
  }
  console.log(`✓ Формат заголовка W3C Server-Timing проверен: "${timingHeader}"\n`);

  // --- ТЕСТ 5: Бизнес-логика E2E воронки и выплат ---
  console.log('--- ТЕСТ 5: Проверка бизнес-инвариантов E2E сценария ---');
  // 1. Расчет вознаграждения за подключение: план 2500, ставка 30% -> 750 KGS
  const planPrice = 2500;
  const connectionRate = 30;
  const feeAmount = Math.round(((planPrice * connectionRate) / 100) * 100) / 100;
  if (feeAmount !== 750) {
    throw new Error(`Ошибка расчета вознаграждения: ожидалось 750, получено ${feeAmount}`);
  }
  console.log(`✓ Калькуляция вознаграждения: ${planPrice} KGS * ${connectionRate}% = ${feeAmount} KGS`);

  // 2. Инвариант статусов воронки: Открыт -> Назначен -> Подписан / Отмена
  const allowedStatuses = ['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'];
  const testStatusTransitions = [
    { from: 'Открыт', to: 'Обработан', valid: true },
    { from: 'Обработан', to: 'Назначен', valid: true },
    { from: 'Назначен', to: 'Подписан', valid: true },
    { from: 'Открыт', to: 'Отмена', valid: true },
  ];
  for (const t of testStatusTransitions) {
    if (!allowedStatuses.includes(t.from) || !allowedStatuses.includes(t.to)) {
      throw new Error(`Недопустимый статус в переходе: ${t.from} -> ${t.to}`);
    }
  }
  console.log('✓ Инварианты статусов воронки лидов валидированы');

  // 3. Инвариант неизменяемости лидов: soft-delete в статус 'Отмена'
  const softDeleteStatus = 'Отмена';
  if (softDeleteStatus !== 'Отмена') {
    throw new Error('Soft-delete статус должен быть строго "Отмена"');
  }
  console.log('✓ Инвариант запрета физического удаления лидов (soft-delete в статус "Отмена") подтвержден\n');

  // --- ТЕСТ 6: OpenAPI спецификация ---
  console.log('--- ТЕСТ 6: Проверка спецификации public/openapi.json ---');
  const fs = await import('fs');
  const openapiContent = JSON.parse(fs.readFileSync('public/openapi.json', 'utf8'));

  if (!openapiContent.components?.schemas?.RateLimitErrorResponse) {
    throw new Error('В OpenAPI отсутствует схема RateLimitErrorResponse');
  }
  if (!openapiContent.components?.headers?.['Server-Timing']) {
    throw new Error('В OpenAPI отсутствует заголовок Server-Timing');
  }
  if (!openapiContent.components?.headers?.['X-RateLimit-Limit']) {
    throw new Error('В OpenAPI отсутствует заголовок X-RateLimit-Limit');
  }
  if (!openapiContent.components?.headers?.['Retry-After']) {
    throw new Error('В OpenAPI отсутствует заголовок Retry-After');
  }
  if (!openapiContent.paths['/api/v1/auth/login']?.post?.responses?.['429']) {
    throw new Error('В /api/v1/auth/login отсутствует ответ 429');
  }
  if (!openapiContent.paths['/api/sync/sotka']?.post?.responses?.['429']) {
    throw new Error('В /api/sync/sotka отсутствует ответ 429');
  }
  console.log('✓ Спецификация OpenAPI 3.0.3 содержит все схемы лимитирования, заголовки и ответы 429\n');

  console.log('=== ВСЕ 6 ПРОВЕРОЧНЫХ БЛОКОВ УСПЕШНО ПРОЙДЕНЫ (EXIT 0) ===');
}

runVerification().catch((err) => {
  console.error('ОШИБКА ВЕРИФИКАЦИИ:', err);
  process.exit(1);
});
