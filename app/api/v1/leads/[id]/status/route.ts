import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import {
  buildStatusChange,
  canChangeLeadStatus,
  canRescheduleLead,
  isCancelReasonDbError,
  isStatusDateDbError,
  leadActorFrom,
  statusDateField,
} from '@/lib/leads/status-rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import type { LeadStatus } from '@/types/database.types';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAuth();
    const body = await req.json();
    const admin = createAdminClient();

    const { status, cancel_reason, cancel_reason_code, meeting_at, next_contact_at } = body as {
      status: LeadStatus;
      cancel_reason?: string | null;
      cancel_reason_code?: string | null;
      meeting_at?: string | null;
      next_contact_at?: string | null;
    };

    if (!status) {
      return apiError('Статус обязателен для заполнения', 'MISSING_STATUS', 400);
    }

    const { data: targetLead } = await admin
      .from('leads')
      .select('lead_id, created_by, assigned_to, status, seller_phone')
      .eq('lead_id', id)
      .maybeSingle();

    if (!targetLead) {
      return apiError('Лид не найден в системе', 'NOT_FOUND', 404);
    }

    const actor = leadActorFrom(ctx);
    // Тот же статус «Встреча» / «Перезвонить» с новой датой — перенос встречи или звонка
    const reschedule = status === targetLead.status && Boolean(statusDateField(status));
    // Единые правила: область видимости, право «leads.status.<целевой>», откат — «leads.rollback»
    const check = reschedule ? canRescheduleLead(actor, targetLead) : canChangeLeadStatus(actor, targetLead, status);
    if (!check.ok) {
      return apiError(check.reason, 'FORBIDDEN', 403);
    }

    // Причина отмены из списка, дата встречи или следующего контакта (051)
    const built = buildStatusChange(status, { cancel_reason, cancel_reason_code, meeting_at, next_contact_at });
    if (!built.ok) {
      return apiError(built.message, built.code, 422);
    }
    const updatePayload: Record<string, unknown> = {
      ...built.updates,
      updated_at: new Date().toISOString(),
    };

    // Запись сервисным клиентом: права уже проверены правилами выше,
    // RLS остается страховкой для прямых запросов к БД
    const { data: updated, error } = await admin
      .from('leads')
      .update(updatePayload as any)
      .eq('lead_id', id)
      .select('lead_id, status, cancel_reason, cancel_reason_code, cancelled_at, meeting_at, next_contact_at, updated_at')
      .single();

    if (error) {
      if (isCancelReasonDbError(error)) {
        return apiError('Для перевода лида в статус «Отмена» укажите причину', 'CANCEL_REASON_REQUIRED', 422);
      }
      if (isStatusDateDbError(error)) {
        return apiError(error.message || 'Укажите дату для этого статуса', 'STATUS_DATE_REQUIRED', 422);
      }
      throw error;
    }

    scheduleTelegramDispatch();
    return apiSuccess({ id, ...updated });
  } catch (err) {
    return handleApiError(err);
  }
}
