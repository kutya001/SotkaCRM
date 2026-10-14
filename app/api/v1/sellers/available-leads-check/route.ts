import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('sellers.menu');
    const { profile } = ctx;

    let query = createAdminClient()
      .from('leads')
      .select('lead_id', { count: 'exact', head: true })
      .is('seller_phone', null)
      .neq('status', 'Отмена');

    // Область видимости модуля «Лиды»: без «leads.view_all» — только свои лиды
    if (!ctx.canViewAll('leads')) {
      query = query.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    const { count, error } = await query;
    if (error) throw error;

    const availableCount = count || 0;
    return apiSuccess({
      has_available_leads: availableCount > 0,
      available_count: availableCount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
