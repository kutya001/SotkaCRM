import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { syncSellersFromSotka } from '@/app/sellers/actions';

// Полная синхронизация реестра может занять больше стандартного лимита функции
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    // Без limit синхронизируется весь реестр Sotka HQ (постранично)
    let offset = 0;
    let limit: number | undefined;

    try {
      const body = await req.json();
      if (Number.isFinite(Number(body.offset))) offset = Math.max(0, Number(body.offset));
      if (body.limit !== undefined && Number.isFinite(Number(body.limit))) limit = Number(body.limit);
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
