import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { LeadsBatchActionSchema } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
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

      scheduleTelegramDispatch();
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

      scheduleTelegramDispatch();
      return apiSuccess({
        success: true,
        action,
        affected_count: data?.length || 0,
        assigned_to: normalizedAssignedTo,
        ids: targetLeadIds,
      });
    }

    if (action === 'delete') {
      // Физическое удаление (admin): разрешено триггером check_lead_deletion_permission
      // и политикой leads_delete_policy (миграция 032)
      const { data: deleted, error } = await supabase
        .from('leads')
        .delete()
        .in('lead_id', targetLeadIds)
        .select('lead_id');

      if (error) throw error;

      scheduleTelegramDispatch();
      return apiSuccess({
        success: true,
        action,
        affected_count: deleted?.length || 0,
        ids: (deleted || []).map((l) => l.lead_id),
      });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
