import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { computePayrollSheet } from '@/lib/payroll/server';
import { SETTLEMENT_MONTH_REGEX } from '@/lib/payroll/classify';
import { PG_UUID_REGEX } from '@/lib/validations';

export async function GET(req: NextRequest) {
  try {
    const { profile, supabase } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к расчетному листку', 'FORBIDDEN', 403);
    }

    const { searchParams } = new URL(req.url);
    const requestedEmpId = searchParams.get('employeeId') || searchParams.get('userId');
    const month = searchParams.get('month') || new Date().toISOString().substring(0, 7);

    if (!SETTLEMENT_MONTH_REGEX.test(month)) {
      return apiError('Расчетный месяц должен быть в формате ГГГГ-ММ', 'VALIDATION_ERROR', 400);
    }

    let targetEmployeeId = profile.user_id;

    if (requestedEmpId && requestedEmpId !== profile.user_id) {
      if (profile.role !== 'admin' && profile.role !== 'supervisor') {
        return apiError('Просмотр расчетного листка других сотрудников запрещен', 'FORBIDDEN', 403);
      }
      if (!PG_UUID_REGEX.test(requestedEmpId)) {
        return apiError('Некорректный идентификатор сотрудника', 'VALIDATION_ERROR', 400);
      }
      targetEmployeeId = requestedEmpId;
    }

    // Тот же расчет, что в реестре операций по ЗП (lib/payroll), права проверены выше
    const sheet = await computePayrollSheet(supabase, targetEmployeeId, month);

    return apiSuccess(sheet);
  } catch (err) {
    return handleApiError(err);
  }
}
