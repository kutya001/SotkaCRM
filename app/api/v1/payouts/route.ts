import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getPayouts, createPayout } from '@/app/payouts/actions';

/** Реестр операций по ЗП: payouts.menu; payouts.view_all — все сотрудники, иначе только свои */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('payouts.menu');
    const { profile } = ctx;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(1000, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || undefined;
    const accrualMonth = searchParams.get('accrualMonth') || undefined;
    const category = searchParams.get('category') || undefined;
    const requestedUserId = searchParams.get('userId') || searchParams.get('employeeId') || undefined;
    const tab = (searchParams.get('tab') as any) || undefined;
    const operationType = searchParams.get('operationType') || undefined;
    const operationSign = searchParams.get('operationSign') || undefined;

    // Строгая изоляция выплат: без payouts.view_all сотрудник видит ТОЛЬКО свои операции
    let targetUserId: string | undefined = undefined;
    if (!ctx.canViewAll('payouts')) {
      if (requestedUserId && requestedUserId !== 'all' && requestedUserId !== profile.user_id) {
        return apiError('Просмотр чужих выплат запрещен ролевой моделью', 'FORBIDDEN', 403);
      }
      targetUserId = profile.user_id;
    } else {
      // Если параметр не задан или равен 'all', фильтр по сотруднику НЕ накладывается
      if (requestedUserId && requestedUserId !== 'all' && requestedUserId.trim() !== '') {
        targetUserId = requestedUserId.trim();
      } else {
        targetUserId = undefined;
      }
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
      tab,
      operationType,
      operationSign,
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

/** Создание операции по ЗП: payouts.create */
export async function POST(req: NextRequest) {
  try {
    await requirePermission('payouts.create');
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
