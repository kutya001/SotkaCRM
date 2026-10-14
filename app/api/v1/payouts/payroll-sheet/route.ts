import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getPayrollSheetAction } from '@/app/payouts/actions';

/** Расчетный лист: payouts.menu; чужой лист — payouts.view_all */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('payouts.menu');
    const { profile } = ctx;
    const { searchParams } = new URL(req.url);

    let employeeId = searchParams.get('employeeId') || searchParams.get('employee_id');
    const month =
      searchParams.get('month') ||
      searchParams.get('settlementMonth') ||
      searchParams.get('settlement_month') ||
      new Date().toISOString().substring(0, 7);

    if (!employeeId) {
      employeeId = profile.user_id;
    } else if (employeeId !== profile.user_id && !ctx.canViewAll('payouts')) {
      return apiError('Просмотр расчетного листка других сотрудников запрещен', 'FORBIDDEN', 403);
    }

    const res = await getPayrollSheetAction(employeeId, month);
    if (!res.success) {
      return apiError(res.error || 'Ошибка расчета расчетного листа', 'PAYROLL_ERROR', 400);
    }

    return apiSuccess(res.sheet);
  } catch (err) {
    return handleApiError(err);
  }
}
