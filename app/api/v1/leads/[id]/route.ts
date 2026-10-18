import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { LeadUpdateSchema, normalizeNullableUuid } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import {
  canAssignLead,
  canEditLeadComment,
  canEditLeadFields,
  implicitStatusForAssignment,
  isLeadInScope,
  leadActorFrom,
} from '@/lib/leads/status-rules';
import { DEFAULT_COUNTRY_CODE, digitsOnly, normalizeNational } from '@/lib/utils/phone';

const LEAD_SELECT = `
  *,
  assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color),
  created_user:users!leads_created_by_fkey(user_id, full_name, role, color)
`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.menu');

    const { data: lead, error } = await createAdminClient()
      .from('leads')
      .select(LEAD_SELECT)
      .eq('lead_id', id)
      .single();

    if (error || !lead) {
      return apiError('Лид не найден в системе', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(leadActorFrom(ctx), lead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    return apiSuccess(lead);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Пустая строка → null, остальное — обрезанная строка; undefined не трогаем (поле не прислано) */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** Поля карточки, для изменения которых требуется полное редактирование («leads.edit») */
const FULL_EDIT_FIELDS = ['client_name', 'phone', 'country_code', 'instagram'] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAuth();
    const actor = leadActorFrom(ctx);
    const body = await req.json();
    const admin = createAdminClient();

    const { data: existingLead } = await admin
      .from('leads')
      .select('lead_id, created_by, assigned_to, status, country_code')
      .eq('lead_id', id)
      .maybeSingle();

    if (!existingLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(actor, existingLead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    const fullEdit = canEditLeadFields(actor, existingLead);
    const commentEdit = canEditLeadComment(actor, existingLead);
    const wantsFieldEdit = FULL_EDIT_FIELDS.some((f) => body[f] !== undefined);
    const wantsCommentEdit = body.comment !== undefined;
    const wantsReassign = body.assigned_to !== undefined
      && normalizeNullableUuid(body.assigned_to) !== (existingLead.assigned_to ?? null);

    if (wantsFieldEdit && !fullEdit) {
      return apiError('Недостаточно прав для редактирования карточки лида', 'FORBIDDEN', 403);
    }
    if (wantsCommentEdit && !commentEdit) {
      return apiError('Недостаточно прав для редактирования комментария лида', 'FORBIDDEN', 403);
    }
    if (wantsReassign && !canAssignLead(actor)) {
      return apiError('Недостаточно прав для назначения ответственного', 'FORBIDDEN', 403);
    }
    if (!fullEdit && !commentEdit && !canAssignLead(actor)) {
      return apiError('Недостаточно прав для редактирования лида', 'FORBIDDEN', 403);
    }

    // Статус через этот маршрут не меняется (см. /status: причина отмены, матрица переходов)
    const sanitizedInput = {
      client_name: body.client_name,
      phone: body.phone !== undefined ? String(body.phone) : undefined,
      country_code:
        body.country_code !== undefined && body.country_code !== null && String(body.country_code).trim() !== ''
          ? digitsOnly(body.country_code)
          : existingLead.country_code || DEFAULT_COUNTRY_CODE,
      instagram: optionalText(body.instagram),
      comment: optionalText(body.comment),
      assigned_to: body.assigned_to !== undefined ? normalizeNullableUuid(body.assigned_to) : undefined,
    };

    const parsed = LeadUpdateSchema.safeParse(sanitizedInput);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Ошибка валидации данных',
        'VALIDATION_ERROR',
        422,
        parsed.error.issues
      );
    }

    const valid = parsed.data;
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (wantsCommentEdit && valid.comment !== undefined) updatePayload.comment = valid.comment;

    if (fullEdit) {
      if (valid.client_name !== undefined) updatePayload.client_name = valid.client_name.trim();
      if (valid.instagram !== undefined) updatePayload.instagram = valid.instagram;

      if (valid.phone !== undefined || body.country_code !== undefined) {
        const countryCode = digitsOnly(valid.country_code) || DEFAULT_COUNTRY_CODE;
        updatePayload.country_code = countryCode;
        if (valid.phone !== undefined) {
          updatePayload.phone = normalizeNational(valid.phone, countryCode);
        }
      }
    }

    if (wantsReassign && valid.assigned_to !== undefined) {
      updatePayload.assigned_to = valid.assigned_to;
      const implicit = implicitStatusForAssignment(existingLead.status, valid.assigned_to);
      if (implicit) updatePayload.status = implicit;
    }

    const { data: updated, error } = await admin
      .from('leads')
      .update(updatePayload as any)
      .eq('lead_id', id)
      .select(LEAD_SELECT)
      .single();

    if (error) throw error;

    scheduleTelegramDispatch();
    return apiSuccess(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.delete');
    const admin = createAdminClient();

    const { data: existingLead } = await admin
      .from('leads')
      .select('lead_id, created_by, assigned_to, seller_phone')
      .eq('lead_id', id)
      .single();

    if (!existingLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(leadActorFrom(ctx), existingLead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    // Привязанный лид сначала отвязывается по общему правилу (046): ожидающее подключение снимается,
    // подтвержденное остается — продавец и подключение не остаются с «висящим» лидом
    if (existingLead.seller_phone) {
      const { unlinkLeadFromSeller } = await import('@/lib/services/lead-linking');
      const unlinked = await unlinkLeadFromSeller(id);
      if (!unlinked.success) {
        return apiError(unlinked.error || 'Не удалось отвязать лид от продавца перед удалением', 'UNLINK_FAILED', 400);
      }
    }

    // Физическое удаление (Hard Delete): сервисный клиент проходит триггер prevent_lead_delete (миграция 032).
    // select() возвращает удаленные строки — при 0 строк удаление не состоялось
    const { data: deleted, error } = await admin
      .from('leads')
      .delete()
      .eq('lead_id', id)
      .select('lead_id');

    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      return apiError('Лид не удален: нет прав на удаление в базе данных', 'DELETE_FORBIDDEN', 403);
    }

    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
