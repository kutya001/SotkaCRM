import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { profile, canViewAll } = await requirePermission('dashboard.menu');

    let leadsQuery = createAdminClient()
      .from('leads')
      .select('lead_id, client_name, phone, country_code, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // Область данных: без «leads.view_all» — только свои лиды
    if (!canViewAll('leads')) {
      leadsQuery = leadsQuery.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    const { data: recentLeads, error } = await leadsQuery;
    if (error) throw error;

    return apiSuccess({
      recent_leads: recentLeads || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
