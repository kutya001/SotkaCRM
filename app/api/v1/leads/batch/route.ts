import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { CancelReasonSchema, LeadsBatchActionSchema } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import {
  canAssignLead,
  canChangeLeadStatus,
  implicitStatusForAssignment,
  isCancelReasonDbError,
  isCancelStatus,
  isLeadInScope,
  leadActorFrom,
} from '@/lib/leads/status-rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('leads.bulk');
    const actor = leadActorFrom(ctx);
    const admin = createAdminClient();
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

    // Текущее состояние выбранных лидов: права и область видимости проверяются по каждому лиду
    const { data: currentLeads, error: readError } = await admin
      .from('leads')
      .select('lead_id, status, created_by, assigned_to')
      .in('lead_id', targetLeadIds);

    if (readError) throw readError;

    const leads = currentLeads || [];
    const outOfScope = leads.filter((l) => !isLeadInScope(actor, l)).map((l) => l.lead_id);
    if (outOfScope.length > 0) {
      return apiError('Часть выбранных лидов вне вашей области видимости', 'FORBIDDEN', 403, {
        denied_ids: outOfScope,
      });
    }

    if (action === 'change_status') {
      if (!status) {
        return apiError('Не указан новый статус для обновления', 'MISSING_PARAM', 400);
      }

      // Лиды, уже находящиеся в целевом статусе, пропускаются; для остальных — проверка перехода
      const toChange = leads.filter((l) => l.status !== status);
      const denied = toChange
        .map((l) => ({ id: l.lead_id, check: canChangeLeadStatus(actor, l, status) }))
        .filter((d) => !d.check.ok);
      if (denied.length > 0) {
        const first = denied[0].check as { ok: false; reason: string };
        return apiError(first.reason, 'FORBIDDEN', 403, { denied_ids: denied.map((d) => d.id) });
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

      const ids = toChange.map((l) => l.lead_id);
      let affected: { lead_id: string; status: string }[] = [];
      if (ids.length > 0) {
        const { data, error } = await admin
          .from('leads')
          .update(updates as any)
          .in('lead_id', ids)
          .select('lead_id, status');

        if (error) {
          if (isCancelReasonDbError(error)) {
            return apiError('Для перевода лидов в статус «Отмена» укажите причину', 'CANCEL_REASON_REQUIRED', 422);
          }
          throw error;
        }
        affected = data || [];
      }

      scheduleTelegramDispatch();
      return apiSuccess({
        success: true,
        action,
        affected_count: affected.length,
        status,
        ids: targetLeadIds,
      });
    }

    if (action === 'change_assigned') {
      if (!canAssignLead(actor)) {
        return apiError('Недостаточно прав для назначения ответственного', 'FORBIDDEN', 403);
      }

      const normalizedAssignedTo = assigned_to || null;

      // Косвенная смена статуса зависит от текущего статуса каждого лида
      const nowIso = new Date().toISOString();
      const groups = new Map<string, string[]>();
      for (const lead of leads) {
        const implicit = implicitStatusForAssignment(lead.status, normalizedAssignedTo) || '';
        const list = groups.get(implicit) || [];
        list.push(lead.lead_id);
        groups.set(implicit, list);
      }

      let affected = 0;
      for (const [implicitStatus, ids] of groups) {
        const updates: Record<string, unknown> = { assigned_to: normalizedAssignedTo, updated_at: nowIso };
        if (implicitStatus) updates.status = implicitStatus;

        const { data, error } = await admin
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
      if (!ctx.can('leads.delete')) {
        return apiError('Недостаточно прав для удаления лидов', 'FORBIDDEN', 403);
      }

      // Физическое удаление: сервисный клиент проходит триггер prevent_lead_delete (миграция 032)
      const ids = leads.map((l) => l.lead_id);
      let deleted: { lead_id: string }[] = [];
      if (ids.length > 0) {
        const { data, error } = await admin
          .from('leads')
          .delete()
          .in('lead_id', ids)
          .select('lead_id');

        if (error) throw error;
        deleted = data || [];
      }

      scheduleTelegramDispatch();
      return apiSuccess({
        success: true,
        action,
        affected_count: deleted.length,
        ids: deleted.map((l) => l.lead_id),
      });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
