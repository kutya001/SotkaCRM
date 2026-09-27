import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import type { LeadStatus } from '@/types/database.types';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, profile } = await requireAuth();
    const body = await req.json();

    const { status, cancel_reason } = body as {
      status: LeadStatus;
      cancel_reason?: string;
    };

    if (!status) {
      return apiError('Статус обязателен для заполнения', 'MISSING_STATUS', 400);
    }

    const { data: targetLead } = await supabase
      .from('leads')
      .select('created_by, assigned_to, status, comment')
      .eq('lead_id', id)
      .single();

    if (!targetLead) {
      return apiError('Лид не найден в системе', 'NOT_FOUND', 404);
    }

    if (profile.role === 'smm') {
      if (targetLead.created_by !== profile.user_id) {
        return apiError('Роль SMM может управлять только своими лидами', 'FORBIDDEN', 403);
      }
      if (
        !['Открыт', 'Обработан'].includes(targetLead.status) ||
        !['Открыт', 'Обработан'].includes(status)
      ) {
        return apiError(
          'SMM-специалисту доступен перевод только между статусами «Открыт» и «Обработан»',
          'FORBIDDEN',
          403
        );
      }
    } else if (profile.role === 'consultant') {
      if (targetLead.assigned_to !== profile.user_id) {
        return apiError('Лид назначен на другого консультанта', 'FORBIDDEN', 403);
      }
      if (!['Назначен', 'Подписан', 'Отмена'].includes(status)) {
        return apiError(
          'Консультант может переводить статус только в «Назначен», «Подписан» или «Отмена»',
          'FORBIDDEN',
          403
        );
      }
    }

    const updatePayload: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'Отмена' && cancel_reason) {
      const now = new Date().toLocaleDateString('ru-RU');
      const note = `[Отмена (${now})]: ${cancel_reason.trim()}`;
      updatePayload.comment = targetLead.comment ? `${targetLead.comment}\n${note}` : note;
    }

    const { error } = await supabase
      .from('leads')
      .update(updatePayload as any)
      .eq('lead_id', id);

    if (error) throw error;

    return apiSuccess({ id, status, updated_at: updatePayload.updated_at });
  } catch (err) {
    return handleApiError(err);
  }
}
