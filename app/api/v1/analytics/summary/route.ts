import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getAnalyticsSummaryAction } from '@/app/analytics/actions';

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к сквозной аналитике', 'FORBIDDEN', 403);
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const res = await getAnalyticsSummaryAction(startDate, endDate);
    if (!res.success || !res.data) {
      return apiError(res.error || 'Ошибка загрузки аналитики', 'FETCH_ANALYTICS_ERROR', 400);
    }

    return apiSuccess(res.data);
  } catch (err) {
    return handleApiError(err);
  }
}
