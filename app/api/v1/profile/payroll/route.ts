import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { profile, supabase } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к расчетному листку', 'FORBIDDEN', 403);
    }

    const { searchParams } = new URL(req.url);
    const requestedEmpId = searchParams.get('employeeId') || searchParams.get('userId');
    const month = searchParams.get('month') || new Date().toISOString().substring(0, 7);

    let targetEmployeeId = profile.user_id;

    if (requestedEmpId && requestedEmpId !== profile.user_id) {
      if (profile.role !== 'admin' && profile.role !== 'supervisor') {
        return apiError('Просмотр расчетного листка других сотрудников запрещен', 'FORBIDDEN', 403);
      }
      targetEmployeeId = requestedEmpId;
    }

    // Вызываем RPC get_employee_payroll_sheet
    const { data, error } = await supabase.rpc('get_employee_payroll_sheet', {
      p_employee_id: targetEmployeeId,
      p_month: month,
    });

    if (error) {
      throw error;
    }

    // Дополнительно получаем информацию о сотруднике
    const { data: employee } = await supabase
      .from('users')
      .select('user_id, full_name, role, login, color')
      .eq('user_id', targetEmployeeId)
      .single();

    const sheet = (data as any) || {};

    return apiSuccess({
      employee: employee || null,
      ...sheet,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
