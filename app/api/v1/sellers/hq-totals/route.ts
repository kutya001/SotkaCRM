import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { authenticateSotkaAdmin, logoutSotkaSession } from '@/lib/services/sotka-api';
import { refreshSellersHqTotals } from '@/lib/services/hq-totals';
import { sellersOwnScopeFilter } from '@/lib/services/sellers';

// Обращение к Sotka HQ по каждому продавцу может занять больше стандартного лимита функции
export const maxDuration = 60;

/**
 * POST /api/v1/sellers/hq-totals — обновление итогов транзакций Sotka HQ (пополнения / списания)
 * для продавцов без итогов или с устаревшими итогами. Вызывается реестром продавцов.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('sellers.transactions');
    let staleHours: number | null = 24;
    let limit = 60;
    try {
      const body = await req.json();
      if (body.stale_hours === null) staleHours = null;
      else if (Number.isFinite(Number(body.stale_hours))) staleHours = Math.max(1, Number(body.stale_hours));
      if (Number.isFinite(Number(body.limit))) limit = Math.min(200, Math.max(1, Number(body.limit)));
    } catch {
      // Тело может быть пустым
    }

    let token = '';
    try {
      token = await authenticateSotkaAdmin();
    } catch (err: any) {
      return apiError(err?.message || 'Sotka HQ недоступен', 'SOTKA_UNAVAILABLE', 502);
    }
    try {
      const result = await refreshSellersHqTotals({
        token,
        staleHours,
        limit,
        scopeFilter: ctx.canViewAll('sellers') ? null : sellersOwnScopeFilter(ctx.profile.user_id),
      });
      return apiSuccess(result);
    } finally {
      await logoutSotkaSession(token);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
