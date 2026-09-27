import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { profile, user } = await requireAuth();

    return apiSuccess({
      id: profile.user_id,
      auth_id: user.id,
      email: user.email,
      login: profile.login,
      full_name: profile.full_name,
      role: profile.role,
      is_active: profile.is_active,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
