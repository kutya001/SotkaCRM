import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    let query = supabase.from('leads').select('status');
    if (profile.role === 'consultant') {
      query = query.eq('assigned_to', profile.user_id);
    } else if (profile.role === 'smm') {
      query = query.eq('created_by', profile.user_id);
    }

    const { data: leads, error } = await query;
    if (error) throw error;

    const list = leads || [];
    const openCount = list.filter((l) => l.status === 'Открыт').length;
    const processedCount = list.filter((l) => l.status === 'Обработан').length;
    const assignedCount = list.filter((l) => l.status === 'Назначен').length;
    const signedCount = list.filter((l) => l.status === 'Подписан').length;
    const cancelledCount = list.filter((l) => l.status === 'Отмена').length;

    return apiSuccess({
      stages: [
        { stage: 'open', label: 'Открыт', count: openCount },
        { stage: 'processed', label: 'Обработан', count: processedCount },
        { stage: 'assigned', label: 'Назначен', count: assignedCount },
        { stage: 'signed', label: 'Подписан', count: signedCount },
        { stage: 'cancelled', label: 'Отмена', count: cancelledCount },
      ],
      total: list.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
