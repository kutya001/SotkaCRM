import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { changeUserPassword } from '@/app/profile/actions';

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();

    const newPassword = body.new_password || body.newPassword;
    if (!newPassword || newPassword.length < 6) {
      return apiError('Пароль должен содержать минимум 6 символов', 'INVALID_PASSWORD', 422);
    }

    const res = await changeUserPassword({
      newPassword,
      targetUserId: body.target_user_id || body.targetUserId,
    });

    if (!res.success) {
      return apiError(res.error || 'Ошибка смены пароля', 'PASSWORD_CHANGE_FAILED', 400);
    }

    return apiSuccess({ success: true, message: 'Пароль успешно обновлен' });
  } catch (err) {
    return handleApiError(err);
  }
}
