import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import {
  getClientIp,
  getRateLimitPolicy,
  checkRateLimit,
  createRateLimitResponse,
  applyRateLimitHeaders,
} from '@/lib/api/rate-limit';

export async function middleware(request: NextRequest) {
  const start = performance.now();
  const pathname = request.nextUrl.pathname;

  // 1. Защита от перегрузок и брутфорса (Rate Limiting)
  const policy = getRateLimitPolicy(pathname);
  let rateLimitResult = null;

  if (policy) {
    const clientIp = getClientIp(request);
    // Для вебхуков Sotka проверяем также заголовок x-api-key если есть
    const apiKey = request.headers.get('x-api-key') || '';
    const rateLimitIdentifier = `${pathname}:${clientIp}${apiKey ? `:${apiKey}` : ''}`;

    rateLimitResult = await checkRateLimit(rateLimitIdentifier, policy);

    if (!rateLimitResult.success) {
      const dur = performance.now() - start;
      const rateLimitResponse = createRateLimitResponse(rateLimitResult);
      rateLimitResponse.headers.set(
        'Server-Timing',
        `app;dur=${dur.toFixed(1)};desc="Rate Limiting", total;dur=${dur.toFixed(1)}`
      );
      return rateLimitResponse;
    }
  }

  // 2. Обработка сессии и ролевой модели Supabase
  const response = await updateSession(request);

  // 3. Сквозное логирование задержек и заголовок Server-Timing для API
  if (pathname.startsWith('/api/')) {
    const totalDur = performance.now() - start;
    const durFormatted = totalDur.toFixed(1);

    // Установка W3C заголовка Server-Timing
    response.headers.set(
      'Server-Timing',
      `app;dur=${durFormatted};desc="Application Processing", total;dur=${durFormatted}`
    );

    // Добавление заголовков X-RateLimit-*
    if (rateLimitResult) {
      applyRateLimitHeaders(response.headers, rateLimitResult);
    }

    // Логирование медленных запросов (> 500ms)
    if (totalDur > 500) {
      const userRole = request.cookies.get('crm_role')?.value || 'anon';
      console.warn(
        `[SLOW API] ${request.method} ${pathname} took ${durFormatted}ms | User: ${userRole}`
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon.ico, icon.svg, sitemap.xml, robots.txt
     * - manifest.webmanifest, manifest.json
     * - static assets (.svg, .png, .jpg, .jpeg, .gif, .webp, .ico, .woff, .woff2, .css, .js)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|manifest.json|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js)$).*)',
  ],
};
