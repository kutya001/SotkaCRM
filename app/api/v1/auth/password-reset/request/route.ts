import { NextRequest } from 'next/server';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { requestPasswordResetByLogin, RESET_CODE_TTL_MINUTES } from '@/lib/telegram/password-reset';

export const dynamic = 'force-dynamic';

/**
 * Запрос кода восстановления пароля (без авторизации).
 * Ответ не раскрывает, существует ли логин: для несуществующего, заблокированного
 * или не привязанного к Telegram логина возвращается тот же нейтральный ответ.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const login = String(body?.login ?? '').trim();
    if (!login) return apiError('Введите логин', 'VALIDATION_ERROR', 422);

    const result = await requestPasswordResetByLogin(login);

    if (result.status === 'not_configured') {
      return apiError('Восстановление через Telegram недоступно: бот не настроен. Обратитесь к администратору.', 'TELEGRAM_NOT_CONFIGURED', 503);
    }
    if (result.status === 'too_soon') {
      return apiError('Код уже отправлен. Запросить новый можно через минуту.', 'TOO_SOON', 429);
    }

    return apiSuccess({
      ok: true,
      ttl_minutes: RESET_CODE_TTL_MINUTES,
      message: `Если логин подключен к Telegram, код отправлен в чат с ботом и действует ${RESET_CODE_TTL_MINUTES} минут.`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
