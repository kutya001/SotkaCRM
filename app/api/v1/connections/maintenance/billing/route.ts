import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { notifyMaintenanceAccruals } from '@/lib/services/connection-notifications';

export async function POST(req: NextRequest) {
  try {
    await requirePermission('connections.accrue');
    // run_maintenance_billing доступна только service_role (миграция 029), право проверено выше
    const supabase = createAdminClient();
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // empty body
    }

    const billingMonth = body.billing_month || body.target_month || new Date().toISOString().substring(0, 7);

    const startedAtIso = new Date().toISOString();
    const { data, error } = await supabase.rpc('run_maintenance_billing', {
      p_billing_month: billingMonth,
    });

    if (error) {
      throw error;
    }

    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/analytics');
    revalidatePath('/profile');
    // Сопровождение: одно сообщение на сотрудника со списком «продавец — сумма» (044)
    await notifyMaintenanceAccruals({ sinceIso: startedAtIso }).catch((err) => console.warn('[billing] Сводка Telegram не отправлена:', err));

    const res = data as any;
    return apiSuccess({
      success: true,
      billing_month: res?.billing_month || billingMonth,
      generated_accruals: res?.generated_accruals || 0,
      message: res?.message || 'Биллинг сопровождения успешно выполнен',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
