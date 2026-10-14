import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

/**
 * Текущий сотрудник: профиль, назначенная роль и ее права.
 * Используется AuthProvider на клиенте для построения меню и проверок can().
 */
export async function GET(_req: NextRequest) {
  try {
    const { profile, user, permissions, isAdmin } = await requireAuth();

    return apiSuccess({
      id: profile.user_id,
      auth_id: user.id,
      email: user.email,
      login: profile.login,
      full_name: profile.full_name,
      role: profile.role,
      role_id: profile.role_id,
      role_code: profile.role_code,
      role_name: profile.role_name,
      is_admin: isAdmin,
      is_active: profile.is_active,
      permissions,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
