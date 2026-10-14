import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getUnpaidAccrualsAction } from '@/app/payouts/actions';

/** Неоплаченные начисления: payouts.menu; чужие — payouts.view_all */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('payouts.menu');
    const { profile } = ctx;

    const { searchParams } = new URL(req.url);
    let targetEmployeeId = searchParams.get('employeeId') || searchParams.get('userId');
    const settlementMonth = searchParams.get('settlementMonth') || searchParams.get('month') || undefined;

    if (!ctx.canViewAll('payouts')) {
      if (targetEmployeeId && targetEmployeeId !== profile.user_id) {
        return apiError('Просмотр начислений других сотрудников запрещен', 'FORBIDDEN', 403);
      }
      targetEmployeeId = profile.user_id;
    } else if (!targetEmployeeId) {
      return apiError('Параметр employeeId обязателен', 'BAD_REQUEST', 400);
    }

    const result = await getUnpaidAccrualsAction(targetEmployeeId, settlementMonth);
    if (!result.success) {
      return apiError(result.error || 'Ошибка получения начислений', 'FETCH_FAILED', 500);
    }

    return apiSuccess({
      employee_id: targetEmployeeId,
      settlement_month: settlementMonth || null,
      accruals: result.accruals,
      total_unpaid_amount: result.accruals.reduce((sum: number, a: any) => sum + (Number(a.amount) || 0), 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
