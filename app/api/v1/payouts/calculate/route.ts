import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // empty body
    }

    const currentMonth = body.accrual_month || new Date().toISOString().substring(0, 7);
    const employeeId = body.employee_id;

    // 1. Считаем бонусы за первичное подключение из connections
    let connQuery = supabase
      .from('connections')
      .select('connection_fee_amount, manager_id')
      .eq('accrual_month', currentMonth);

    if (employeeId) {
      connQuery = connQuery.eq('manager_id', employeeId);
    }

    const { data: connData } = await connQuery;

    // 2. Считаем бонусы за ежемесячное сопровождение из client_maintenance
    let maintQuery = supabase
      .from('client_maintenance')
      .select('maintenance_amount, manager_id')
      .eq('accrual_month', currentMonth);

    if (employeeId) {
      maintQuery = maintQuery.eq('manager_id', employeeId);
    }

    const { data: maintData } = await maintQuery;

    const totalConnectionBonus = (connData || []).reduce(
      (sum, c) => sum + (Number(c.connection_fee_amount) || 0),
      0
    );
    const totalMaintenanceBonus = (maintData || []).reduce(
      (sum, m) => sum + (Number(m.maintenance_amount) || 0),
      0
    );

    const totalAccrued = totalConnectionBonus + totalMaintenanceBonus;
    const recordsCount = (connData?.length || 0) + (maintData?.length || 0);

    return apiSuccess({
      accrual_month: currentMonth,
      employee_id: employeeId || null,
      total_connection_bonus: totalConnectionBonus,
      total_maintenance_bonus: totalMaintenanceBonus,
      total_accrued: totalAccrued,
      calculated_records: recordsCount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
