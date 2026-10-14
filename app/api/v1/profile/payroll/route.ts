import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { computePayrollSheet } from '@/lib/payroll/server';
import { SETTLEMENT_MONTH_REGEX } from '@/lib/payroll/classify';
import { PG_UUID_REGEX } from '@/lib/validations';

/** Расчетный листок в профиле: payouts.menu; чужой — payouts.view_all */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('payouts.menu');
    const { profile } = ctx;

    const { searchParams } = new URL(req.url);
    const requestedEmpId = searchParams.get('employeeId') || searchParams.get('userId');
    const month = searchParams.get('month') || new Date().toISOString().substring(0, 7);

    if (!SETTLEMENT_MONTH_REGEX.test(month)) {
      return apiError('Расчетный месяц должен быть в формате ГГГГ-ММ', 'VALIDATION_ERROR', 400);
    }

    let targetEmployeeId = profile.user_id;

    if (requestedEmpId && requestedEmpId !== profile.user_id) {
      if (!ctx.canViewAll('payouts')) {
        return apiError('Просмотр расчетного листка других сотрудников запрещен', 'FORBIDDEN', 403);
      }
      if (!PG_UUID_REGEX.test(requestedEmpId)) {
        return apiError('Некорректный идентификатор сотрудника', 'VALIDATION_ERROR', 400);
      }
      targetEmployeeId = requestedEmpId;
    }

    // Тот же расчет, что в реестре операций по ЗП (lib/payroll); область задана выше, выборка — сервисным клиентом
    const sheet = await computePayrollSheet(createAdminClient(), targetEmployeeId, month);

    return apiSuccess(sheet);
  } catch (err) {
    return handleApiError(err);
  }
}
