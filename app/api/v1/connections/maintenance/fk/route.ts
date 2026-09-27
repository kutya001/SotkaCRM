import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { generateMonthlyMaintenanceAccruals } from '@/app/connections/maintenance-actions';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();

    let targetMonth: string | undefined;
    try {
      const body = await req.json();
      targetMonth = body.target_month;
    } catch {
      // Body may be empty
    }

    // 1. Запуск биллинга сопровождения
    const accrualResult = await generateMonthlyMaintenanceAccruals(targetMonth);

    // 2. Диагностика целостности связей connections -> sellers
    const { data: orphanedConnections } = await supabase
      .from('connections')
      .select('connection_id, seller_phone')
      .is('seller_name', null);

    return apiSuccess({
      status: 'healthy',
      maintenance_billing: accrualResult,
      orphaned_count: orphanedConnections?.length || 0,
      restored_relations: 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
