import { NextRequest } from 'next/server';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { confirmPasswordReset } from '@/lib/telegram/password-reset';

export const dynamic = 'force-dynamic';

/** Установка нового пароля по коду из Telegram (без авторизации) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const login = String(body?.login ?? '').trim();
    const code = String(body?.code ?? '').trim();
    const password = String(body?.password ?? '');

    if (!login || !code) return apiError('Введите логин и код из Telegram', 'VALIDATION_ERROR', 422);
    if (password.length < 6) return apiError('Пароль должен содержать минимум 6 символов', 'VALIDATION_ERROR', 422);
    if (password.length > 72) return apiError('Пароль слишком длинный', 'VALIDATION_ERROR', 422);

    const result = await confirmPasswordReset(login, code, password);

    switch (result.status) {
      case 'ok':
        return apiSuccess({ ok: true, message: 'Пароль изменен. Войдите с новым паролем.' });
      case 'invalid_code':
        return apiError(`Неверный код. Осталось попыток: ${result.attemptsLeft}`, 'INVALID_CODE', 400);
      case 'expired':
      case 'not_found':
      default:
        return apiError('Код недействителен или устарел. Запросите новый код.', 'CODE_EXPIRED', 400);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
