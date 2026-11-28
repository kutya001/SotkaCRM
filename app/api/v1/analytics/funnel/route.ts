import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { LEAD_STATUSES } from '@/lib/leads/status-rules';
import { STATUS_COUNT_KEY, countLeadStatuses } from '@/lib/leads/stats';

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
    const counts = countLeadStatuses(list);
    const total = counts.total;
    const calcPercent = (val: number) => (total > 0 ? Math.round((val / total) * 1000) / 10 : 0);

    return apiSuccess({
      steps: LEAD_STATUSES.map((status) => {
        const count = counts[STATUS_COUNT_KEY[status]];
        return { step: STATUS_COUNT_KEY[status], label: status, count, percent: calcPercent(count) };
      }),
      total_leads: total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
