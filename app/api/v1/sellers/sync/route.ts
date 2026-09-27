import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { syncSellersFromSotka } from '@/app/sellers/actions';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    let offset = 0;
    let limit = 50;

    try {
      const body = await req.json();
      if (body.offset !== undefined) offset = Number(body.offset);
      if (body.limit !== undefined) limit = Number(body.limit);
    } catch {
      // Body may be empty in case of simple POST button click
    }

    const startTime = Date.now();
    const result = await syncSellersFromSotka(offset, limit);
    const durationMs = Date.now() - startTime;

    if (!result.success) {
      return apiError(result.error || 'Ошибка синхронизации с Sotka API', 'SYNC_ERROR', 500);
    }

    return apiSuccess({
      synced_count: result.syncedCount,
      total_available: result.total,
      duration_ms: durationMs,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
