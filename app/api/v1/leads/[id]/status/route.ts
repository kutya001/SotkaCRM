import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { CancelReasonSchema } from '@/lib/validations';
import {
  canChangeLeadStatus,
  isCancelReasonDbError,
  isCancelStatus,
  leadActorFrom,
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

    const { status, cancel_reason } = body as {
      status: LeadStatus;
      cancel_reason?: string | null;
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

    // Единые правила: область видимости, право «leads.status.<целевой>», откат — «leads.rollback»
    const check = canChangeLeadStatus(leadActorFrom(ctx), targetLead, status);
    if (!check.ok) {
      return apiError(check.reason, 'FORBIDDEN', 403);
    }

    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (isCancelStatus(status)) {
      const parsedReason = CancelReasonSchema.safeParse(cancel_reason ?? '');
      if (!parsedReason.success) {
        return apiError(
          parsedReason.error.issues[0]?.message || 'Укажите причину отмены лида',
          'CANCEL_REASON_REQUIRED',
          422
        );
      }
      updatePayload.cancel_reason = parsedReason.data;
    }

    // Запись сервисным клиентом: права уже проверены правилами выше,
    // RLS остается страховкой для прямых запросов к БД
    const { data: updated, error } = await admin
      .from('leads')
      .update(updatePayload as any)
      .eq('lead_id', id)
      .select('lead_id, status, cancel_reason, cancelled_at, updated_at')
      .single();

    if (error) {
      if (isCancelReasonDbError(error)) {
        return apiError('Для перевода лида в статус «Отмена» укажите причину', 'CANCEL_REASON_REQUIRED', 422);
      }
      throw error;
    }

    scheduleTelegramDispatch();
    return apiSuccess({ id, ...updated });
  } catch (err) {
    return handleApiError(err);
  }
}
