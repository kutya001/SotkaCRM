import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

/** KPI сотрудников (analytics.employees): результативность консультантов по лидам */
export async function GET(_req: NextRequest) {
  try {
    await requirePermission('analytics.employees');
    const supabase = createAdminClient();

    // Запрашиваем консультантов и их результативность
    const { data: consultants, error: userErr } = await supabase
      .from('users')
      .select('user_id, full_name, role, login, color')
      .eq('is_active', true)
      .eq('role', 'consultant');

    if (userErr) throw userErr;

    const { data: leads } = await supabase
      .from('leads')
      .select('assigned_to, status');

    const leaderboard = (consultants || []).map((c) => {
      const userLeads = (leads || []).filter((l) => l.assigned_to === c.user_id);
      const totalAssigned = userLeads.length;
      const signedCount = userLeads.filter((l) => l.status === 'Подписан').length;
      const conversionRate = totalAssigned > 0 ? Math.round((signedCount / totalAssigned) * 1000) / 10 : 0;

      return {
        employee_id: c.user_id,
        name: c.full_name,
        role: c.role,
        color: c.color,
        total_leads: totalAssigned,
        signed_leads: signedCount,
        conversion_rate: conversionRate,
      };
    }).sort((a, b) => b.signed_leads - a.signed_leads);

    return apiSuccess({ leaderboard });
  } catch (err) {
    return handleApiError(err);
  }
}
