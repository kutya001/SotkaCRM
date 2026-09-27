import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { LeadsBatchActionSchema } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function POST(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAdmin();
    const body = await req.json();

    const parsed = LeadsBatchActionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Ошибка валидации пакетной операции',
        'VALIDATION_ERROR',
        422,
        parsed.error.issues
      );
    }

    const action = parsed.data.action;
    const targetLeadIds = (parsed.data.lead_ids || parsed.data.ids || []) as string[];
    const status = parsed.data.status || parsed.data.payload?.status;
    const assigned_to = parsed.data.assigned_to !== undefined ? parsed.data.assigned_to : parsed.data.payload?.assigned_to;

    if (action === 'change_status') {
      if (!status) {
        return apiError('Не указан новый статус для обновления', 'MISSING_PARAM', 400);
      }

      const { data, error } = await supabase
        .from('leads')
        .update({
          status,
          updated_at: new Date().toISOString(),
        } as any)
        .in('lead_id', targetLeadIds)
        .select('lead_id, status');

      if (error) throw error;

      return apiSuccess({
        success: true,
        action,
        affected_count: data?.length || 0,
        status,
        ids: targetLeadIds,
      });
    }

    if (action === 'change_assigned') {
      const normalizedAssignedTo = assigned_to || null;

      const { data, error } = await supabase
        .from('leads')
        .update({
          assigned_to: normalizedAssignedTo,
          updated_at: new Date().toISOString(),
        } as any)
        .in('lead_id', targetLeadIds)
        .select('lead_id, assigned_to');

      if (error) throw error;

      return apiSuccess({
        success: true,
        action,
        affected_count: data?.length || 0,
        assigned_to: normalizedAssignedTo,
        ids: targetLeadIds,
      });
    }

    if (action === 'delete') {
      // Физический DELETE запрещен инвариантом базы (триггер prevent_lead_delete).
      // Переводим лиды в статус 'Отмена' с примечанием администратора.
      const now = new Date().toLocaleDateString('ru-RU');
      const note = `[Отмена (${now})]: Массовое исключение администратором ${profile.full_name}`;

      const { data: existingLeads } = await supabase
        .from('leads')
        .select('lead_id, comment')
        .in('lead_id', targetLeadIds);

      const updatePromises = (existingLeads || []).map((lead) => {
        const updatedComment = lead.comment ? `${lead.comment}\n${note}` : note;
        return supabase
          .from('leads')
          .update({
            status: 'Отмена',
            comment: updatedComment,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('lead_id', lead.lead_id);
      });

      await Promise.all(updatePromises);

      return apiSuccess({
        success: true,
        action,
        affected_count: existingLeads?.length || 0,
        ids: targetLeadIds,
        status: 'Отмена',
      });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
