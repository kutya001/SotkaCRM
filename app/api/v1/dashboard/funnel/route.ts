import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { LEAD_STATUSES } from '@/lib/leads/status-rules';
import { STATUS_COUNT_KEY, countLeadStatuses } from '@/lib/leads/stats';

export async function GET(req: NextRequest) {
  try {
    const { profile, canViewAll } = await requirePermission('dashboard.menu');

    let query = createAdminClient().from('leads').select('status');
    // Область данных: без «leads.view_all» — только свои лиды
    if (!canViewAll('leads')) {
      query = query.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    const { data: leads, error } = await query;
    if (error) throw error;

    const list = leads || [];
    const counts = countLeadStatuses(list);

    return apiSuccess({
      stages: LEAD_STATUSES.map((status) => ({
        stage: STATUS_COUNT_KEY[status],
        label: status,
        count: counts[STATUS_COUNT_KEY[status]],
      })),
      total: counts.total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
