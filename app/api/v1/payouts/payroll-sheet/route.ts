import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getPayrollSheetAction } from '@/app/payouts/actions';

export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    const { searchParams } = new URL(req.url);

    let employeeId = searchParams.get('employeeId');
    const month = searchParams.get('month') || new Date().toISOString().substring(0, 7);

    // Консультант и SMM могут запрашивать расчетный лист только для себя
    if (profile.role !== 'admin' && profile.role !== 'supervisor') {
      employeeId = profile.user_id;
    } else if (!employeeId) {
      employeeId = profile.user_id;
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
