import { NextRequest } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getPayouts, createPayout } from '@/app/payouts/actions';

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || undefined;
    const accrualMonth = searchParams.get('accrualMonth') || undefined;
    const category = searchParams.get('category') || undefined;
    const requestedUserId = searchParams.get('userId') || undefined;

    // Строгая ролевая изоляция выплат:
    // admin и supervisor могут просматривать любые выплаты
    // consultant и smm видят ТОЛЬКО свои выплаты
    let targetUserId = requestedUserId;
    if (profile.role !== 'admin' && profile.role !== 'supervisor') {
      if (requestedUserId && requestedUserId !== profile.user_id) {
        return apiError('Просмотр чужих выплат запрещен ролевой моделью', 'FORBIDDEN', 403);
      }
      targetUserId = profile.user_id;
    }
    const sortBy = searchParams.get('sortBy') || undefined;
    const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || undefined;

    const res = await getPayouts({
      page,
      pageSize,
      search,
      accrualMonth,
      category,
      userId: targetUserId,
      sortBy,
      sortOrder,
    });

    return apiSuccess({
      items: res.payouts,
      total: res.totalCount,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const res = await createPayout(body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка создания выплаты', 'PAYOUT_FAILED', 400);
    }

    return apiSuccess({
      success: true,
      message: 'Выплата успешно зарегистрирована',
      payout_id: res.payout_id,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
