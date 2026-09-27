import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { getUserProfileAndKpi } from '@/app/profile/actions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId') || undefined;

    const res = await getUserProfileAndKpi(targetUserId);
    return apiSuccess(res);
  } catch (err) {
    return handleApiError(err);
  }
}
