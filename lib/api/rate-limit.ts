import { NextResponse } from 'next/server';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp в секундах
  retryAfter: number; // Секунды до сброса
}

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

// In-Memory хранилище скользящего окна
interface MemoryRecord {
  timestamps: number[];
}

const memoryStore = new Map<string, MemoryRecord>();
let lastCleanup = Date.now();

function cleanupMemoryStore(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < 30000 && memoryStore.size < 5000) {
    return;
  }
  lastCleanup = now;

  for (const [key, record] of memoryStore.entries()) {
    const validTimestamps = record.timestamps.filter((t) => now - t < windowMs);
    if (validTimestamps.length === 0) {
      memoryStore.delete(key);
    } else {
      record.timestamps = validTimestamps;
    }
  }
}

/**
 * Извлечение реального IP-адреса клиента
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  return '127.0.0.1';
}

/**
 * Определение политики лимитирования по URL пути
 */
export function getRateLimitPolicy(pathname: string): RateLimitPolicy | null {
  // 1. Строгий лимит на вход (5 запросов в минуту)
  if (pathname === '/api/v1/auth/login') {
    return { limit: 5, windowSeconds: 60 };
  }

  // 2. Лимит для внешних вебхуков и интеграций (30 запросов в минуту)
  if (pathname === '/api/sync/sotka') {
    return { limit: 30, windowSeconds: 60 };
  }

  // 3. Общий лимит для остальных эндпоинтов REST API v1 (120 запросов в минуту)
  if (pathname.startsWith('/api/v1/')) {
    return { limit: 120, windowSeconds: 60 };
  }

  return null;
}

/**
 * Проверка лимита через Upstash Redis REST API (если сконфигурирован)
 */
async function checkUpstashRedis(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  const now = Date.now();
  const clearBefore = now - windowSeconds * 1000;
  const redisKey = `ratelimit:${key}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    const pipelineCommands = [
      ['ZREMRANGEBYSCORE', redisKey, '0', String(clearBefore)],
      ['ZCARD', redisKey],
      ['ZADD', redisKey, String(now), `${now}-${Math.random()}`],
      ['EXPIRE', redisKey, String(windowSeconds)],
    ];

    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipelineCommands),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const currentCount = Number(data[1]?.result) || 0;

    const resetTimestamp = Math.ceil((now + windowSeconds * 1000) / 1000);
    const retryAfter = Math.max(1, windowSeconds);

    if (currentCount >= limit) {
      return {
        success: false,
        limit,
        remaining: 0,
        reset: resetTimestamp,
        retryAfter,
      };
    }

    return {
      success: true,
      limit,
      remaining: Math.max(0, limit - (currentCount + 1)),
      reset: resetTimestamp,
      retryAfter: 0,
    };
  } catch (err) {
    console.warn('[RateLimit] Upstash Redis недоступен, fallback на in-memory:', err);
    return null;
  }
}

/**
 * Проверка скользящего окна в In-Memory хранилище
 */
function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  cleanupMemoryStore(windowMs);

  let record = memoryStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    memoryStore.set(key, record);
  }

  // Фильтруем метки времени, оставляя только попадающие в текущее окно
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  if (record.timestamps.length >= limit) {
    const oldestTimestamp = record.timestamps[0];
    const timeUntilOldestExpires = oldestTimestamp + windowMs - now;
    const retryAfter = Math.max(1, Math.ceil(timeUntilOldestExpires / 1000));
    const reset = Math.ceil((oldestTimestamp + windowMs) / 1000);

    return {
      success: false,
      limit,
      remaining: 0,
      reset,
      retryAfter,
    };
  }

  record.timestamps.push(now);
  const remaining = Math.max(0, limit - record.timestamps.length);
  const reset = Math.ceil((now + windowMs) / 1000);

  return {
    success: true,
    limit,
    remaining,
    reset,
    retryAfter: 0,
  };
}

/**
 * Главная функция проверки лимита запросов
 */
export async function checkRateLimit(
  identifier: string,
  policy: RateLimitPolicy
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = policy;

  // 1. Попытка через Upstash Redis (если настроен)
  const upstashResult = await checkUpstashRedis(identifier, limit, windowSeconds);
  if (upstashResult) {
    return upstashResult;
  }

  // 2. Fallback на локальное in-memory хранилище
  return checkMemoryRateLimit(identifier, limit, windowSeconds);
}

/**
 * Генерация ответа HTTP 429 Too Many Requests
 */
export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: 'Слишком много запросов. Пожалуйста, подождите перед повторной попыткой.',
      code: 'RATE_LIMIT_EXCEEDED',
      retry_after: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(result.reset),
      },
    }
  );
}

/**
 * Добавление заголовков лимитирования в успешный ответ
 */
export function applyRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult
): void {
  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(result.reset));
}
