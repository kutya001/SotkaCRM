import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    let leadsQuery = supabase
      .from('leads')
      .select('lead_id, client_name, phone, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (profile.role === 'consultant') {
      leadsQuery = leadsQuery.eq('assigned_to', profile.user_id);
    } else if (profile.role === 'smm') {
      leadsQuery = leadsQuery.eq('created_by', profile.user_id);
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
