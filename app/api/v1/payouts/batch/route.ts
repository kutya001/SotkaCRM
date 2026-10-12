import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { batchPayoutsAction } from '@/app/payouts/actions';

/**
 * Массовые операции над операциями по ЗП (admin):
 * { action: 'update', ids, changes } | { action: 'delete', ids }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const res = await batchPayoutsAction(body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка массовой операции', 'BATCH_FAILED', 400);
    }

    return apiSuccess(res);
  } catch (err) {
    return handleApiError(err);
  }
}
