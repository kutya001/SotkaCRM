import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();

    const isAdmin = profile.role === 'admin';
    return apiSuccess({
      role: profile.role,
      is_admin: isAdmin,
      can_access_docs: isAdmin,
      can_sync_api: isAdmin,
      can_manage_rates: isAdmin,
      can_manage_plans: isAdmin,
      can_manage_employees: isAdmin || profile.role === 'supervisor',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
