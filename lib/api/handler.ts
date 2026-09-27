import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: any;
}

export function apiSuccess<T>(data: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}

export function apiError(
  message: string,
  code = 'BAD_REQUEST',
  status = 400,
  details?: any,
  headers?: HeadersInit
) {
  return NextResponse.json<ApiErrorBody>(
    {
      error: message,
      code,
      details,
    },
    { status, headers }
  );
}

export function handleApiError(err: any): NextResponse<ApiErrorBody> {
  console.error('[API Error]:', err);

  if (err instanceof ZodError) {
    return apiError(
      err.issues[0]?.message || 'Ошибка валидации данных',
      'VALIDATION_ERROR',
      422,
      err.issues
    );
  }

  const msg = err?.message || 'Внутренняя ошибка сервера';

  if (
    msg.includes('не авторизован') ||
    msg.includes('не аутентифицирован') ||
    msg.includes('JWT') ||
    msg.includes('Auth session missing')
  ) {
    return apiError(msg, 'UNAUTHORIZED', 401);
  }

  if (
    msg.includes('Недостаточно прав') ||
    msg.includes('исключительно администратор') ||
    msg.includes('заблокирована')
  ) {
    return apiError(msg, 'FORBIDDEN', 403);
  }

  if (msg.includes('не найден')) {
    return apiError(msg, 'NOT_FOUND', 404);
  }

  return apiError(msg, 'INTERNAL_SERVER_ERROR', 500);
}
