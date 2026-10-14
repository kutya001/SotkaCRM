import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

/** Воронка лидов: analytics.menu; область лидов — leads.view_all либо свои (назначенные или созданные) */
export async function GET(_req: NextRequest) {
  try {
    const ctx = await requirePermission('analytics.menu');
    const { profile } = ctx;

    let query = createAdminClient().from('leads').select('status, created_at');
    if (!ctx.canViewAll('leads')) {
      query = query.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    const { data: leads, error } = await query;
    if (error) throw error;

    const list = leads || [];
    const total = list.length;
    const openCount = list.filter((l) => l.status === 'Открыт').length;
    const processedCount = list.filter((l) => l.status === 'Обработан').length;
    const assignedCount = list.filter((l) => l.status === 'Назначен').length;
    const signedCount = list.filter((l) => l.status === 'Подписан').length;
    const cancelledCount = list.filter((l) => l.status === 'Отмена').length;

    const calcPercent = (val: number) => (total > 0 ? Math.round((val / total) * 1000) / 10 : 0);

    return apiSuccess({
      steps: [
        { step: 'open', label: 'Открыт', count: openCount, percent: calcPercent(openCount) },
        { step: 'processed', label: 'Обработан', count: processedCount, percent: calcPercent(processedCount) },
        { step: 'assigned', label: 'Назначен', count: assignedCount, percent: calcPercent(assignedCount) },
        { step: 'signed', label: 'Подписан', count: signedCount, percent: calcPercent(signedCount) },
        { step: 'cancelled', label: 'Отмена', count: cancelledCount, percent: calcPercent(cancelledCount) },
      ],
      total_leads: total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
