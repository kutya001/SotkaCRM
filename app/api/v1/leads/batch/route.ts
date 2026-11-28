import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { LeadsBatchActionSchema } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import {
  buildStatusChange,
  canAssignLead,
  canChangeLeadStatus,
  implicitStatusForAssignment,
  isCancelReasonDbError,
  isLeadInScope,
  isStatusDateDbError,
  leadActorFrom,
  reassignBlockReason,
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
    const statusInput = {
      cancel_reason: cancelReason,
      cancel_reason_code: parsed.data.cancel_reason_code ?? parsed.data.payload?.cancel_reason_code,
      meeting_at: parsed.data.meeting_at ?? parsed.data.payload?.meeting_at,
      next_contact_at: parsed.data.next_contact_at ?? parsed.data.payload?.next_contact_at,
    };
    const assigned_to = parsed.data.assigned_to !== undefined ? parsed.data.assigned_to : parsed.data.payload?.assigned_to;

    // Текущее состояние выбранных лидов: права и область видимости проверяются по каждому лиду
    const { data: currentLeads, error: readError } = await admin
      .from('leads')
      .select('lead_id, status, created_by, assigned_to, seller_phone')
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

      // Причина отмены из списка, дата встречи или следующего контакта — одна на все выбранные лиды (051)
      const built = buildStatusChange(status, statusInput);
      if (!built.ok) {
        return apiError(built.message, built.code, 422);
      }
      const updates: Record<string, unknown> = {
        ...built.updates,
        updated_at: new Date().toISOString(),
      };

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
          if (isStatusDateDbError(error)) {
            return apiError(error.message || 'Укажите дату для этого статуса', 'STATUS_DATE_REQUIRED', 422);
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

      // Привязанным лидам ответственного не меняют — им остается консультант подключения (046)
      const linked = leads.filter((l) => (l.assigned_to ?? null) !== normalizedAssignedTo && reassignBlockReason(l));
      if (linked.length > 0) {
        return apiError(
          `Лидов, привязанных к продавцу: ${linked.length}. Их ответственный — консультант подключения; сначала отвяжите продавца`,
          'LEAD_LINKED',
          409,
          { denied_ids: linked.map((l) => l.lead_id) }
        );
      }

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
