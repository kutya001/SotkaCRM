import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { CancelReasonSchema, LeadsBatchActionSchema } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { implicitStatusForAssignment, isCancelReasonDbError, isCancelStatus } from '@/lib/leads/status-rules';
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
    const cancelReason = parsed.data.cancel_reason ?? parsed.data.payload?.cancel_reason;
    const assigned_to = parsed.data.assigned_to !== undefined ? parsed.data.assigned_to : parsed.data.payload?.assigned_to;

    if (action === 'change_status') {
      if (!status) {
        return apiError('Не указан новый статус для обновления', 'MISSING_PARAM', 400);
      }

      const updates: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };

      if (isCancelStatus(status)) {
        const parsedReason = CancelReasonSchema.safeParse(cancelReason ?? '');
        if (!parsedReason.success) {
          return apiError(
            parsedReason.error.issues[0]?.message || 'Укажите причину отмены лидов',
            'CANCEL_REASON_REQUIRED',
            422
          );
        }
        updates.cancel_reason = parsedReason.data;
      }

      const { data, error } = await supabase
        .from('leads')
        .update(updates as any)
        .in('lead_id', targetLeadIds)
        .select('lead_id, status');

      if (error) {
        if (isCancelReasonDbError(error)) {
          return apiError('Для перевода лидов в статус «Отмена» укажите причину', 'CANCEL_REASON_REQUIRED', 422);
        }
        throw error;
      }

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

      // Косвенная смена статуса зависит от текущего статуса каждого лида
      const { data: currentLeads, error: readError } = await supabase
        .from('leads')
        .select('lead_id, status')
        .in('lead_id', targetLeadIds);

      if (readError) throw readError;

      const nowIso = new Date().toISOString();
      const groups = new Map<string, string[]>();
      for (const lead of currentLeads || []) {
        const implicit = implicitStatusForAssignment(lead.status, normalizedAssignedTo) || '';
        const list = groups.get(implicit) || [];
        list.push(lead.lead_id);
        groups.set(implicit, list);
      }

      let affected = 0;
      for (const [implicitStatus, ids] of groups) {
        const updates: Record<string, unknown> = { assigned_to: normalizedAssignedTo, updated_at: nowIso };
        if (implicitStatus) updates.status = implicitStatus;

        const { data, error } = await supabase
          .from('leads')
          .update(updates as any)
          .in('lead_id', ids)
          .select('lead_id');

        if (error) throw error;
        affected += data?.length || 0;
      }

      scheduleTelegramDispatch();
      return apiSuccess({
        success: true,
        action,
        affected_count: affected,
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
