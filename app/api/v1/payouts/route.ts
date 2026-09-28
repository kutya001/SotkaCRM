import { NextRequest } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getPayouts, createPayout } from '@/app/payouts/actions';

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();

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

    // Строгая ролевая изоляция выплат:
    // admin и supervisor видят абсолютно все операции системы без фильтров по сотруднику по умолчанию
    // consultant и smm видят ТОЛЬКО свои выплаты
    const roleLower = (profile.role || '').toLowerCase();
    const isPrivileged = roleLower === 'admin' || roleLower === 'supervisor';

    let targetUserId: string | undefined = undefined;
    if (!isPrivileged) {
      if (requestedUserId && requestedUserId !== profile.user_id) {
        return apiError('Просмотр чужих выплат запрещен ролевой моделью', 'FORBIDDEN', 403);
      }
      targetUserId = profile.user_id;
    } else {
      // Для администратора: если параметр не задан или равен 'all', фильтр по сотруднику НЕ накладывается
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
