import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    let query = supabase.from('leads').select('status, created_at');
    if (profile.role === 'consultant') {
      query = query.eq('assigned_to', profile.user_id);
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
