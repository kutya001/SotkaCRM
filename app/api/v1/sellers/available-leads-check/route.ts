import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    if (profile.role === 'smm') {
      return apiSuccess({ has_available_leads: false, available_count: 0 });
    }

    let query = supabase
      .from('leads')
      .select('lead_id', { count: 'exact', head: true })
      .is('seller_phone', null)
      .neq('status', 'Отмена');

    if (profile.role === 'consultant') {
      query = query.eq('assigned_to', profile.user_id);
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
