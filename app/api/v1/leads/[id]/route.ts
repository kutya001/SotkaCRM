import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { LeadUpdateSchema, normalizeNullableUuid } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { canEditLeadFields, implicitStatusForAssignment } from '@/lib/leads/status-rules';
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
    const { supabase, profile } = await requireAuth();

    const { data: lead, error } = await supabase
      .from('leads')
      .select(LEAD_SELECT)
      .eq('lead_id', id)
      .single();

    if (error || !lead) {
      return apiError('Лид не найден в системе', 'NOT_FOUND', 404);
    }

    if (profile.role === 'consultant' && lead.assigned_to !== profile.user_id) {
      return apiError('Лид назначен на другого консультанта', 'FORBIDDEN', 403);
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, profile } = await requireAuth();
    const body = await req.json();

    const { data: existingLead } = await supabase
      .from('leads')
      .select('lead_id, created_by, assigned_to, status, country_code')
      .eq('lead_id', id)
      .maybeSingle();

    if (!existingLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    // Единая матрица ролей: supervisor — только просмотр, smm — свои в Открыт/Обработан,
    // consultant — свои в Назначен/Подписан, admin — всё
    if (!canEditLeadFields(profile.role, existingLead, profile.user_id)) {
      const reason =
        profile.role === 'supervisor'
          ? 'Руководитель может только просматривать лиды'
          : profile.role === 'smm'
          ? 'SMM-специалист редактирует только свои лиды в статусах «Открыт» и «Обработан»'
          : profile.role === 'consultant'
          ? 'Консультант редактирует только свои лиды в статусах «Назначен» и «Подписан»'
          : 'Недостаточно прав для редактирования лида';
      return apiError(reason, 'FORBIDDEN', 403);
    }

    const wantsReassign = body.assigned_to !== undefined
      && normalizeNullableUuid(body.assigned_to) !== (existingLead.assigned_to ?? null);
    if (wantsReassign && profile.role !== 'admin') {
      return apiError('Назначать ответственного может только администратор', 'FORBIDDEN', 403);
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

    // Консультант меняет только комментарий
    if (profile.role === 'consultant') {
      if (valid.comment !== undefined) updatePayload.comment = valid.comment;
    } else {
      if (valid.client_name !== undefined) updatePayload.client_name = valid.client_name.trim();
      if (valid.instagram !== undefined) updatePayload.instagram = valid.instagram;
      if (valid.comment !== undefined) updatePayload.comment = valid.comment;

      if (valid.phone !== undefined || body.country_code !== undefined) {
        const countryCode = digitsOnly(valid.country_code) || DEFAULT_COUNTRY_CODE;
        updatePayload.country_code = countryCode;
        if (valid.phone !== undefined) {
          updatePayload.phone = normalizeNational(valid.phone, countryCode);
        }
      }

      if (wantsReassign && valid.assigned_to !== undefined) {
        updatePayload.assigned_to = valid.assigned_to;
        const implicit = implicitStatusForAssignment(existingLead.status, valid.assigned_to);
        if (implicit) updatePayload.status = implicit;
      }
    }

    const { data: updated, error } = await supabase
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
    const { supabase, profile } = await requireAuth();

    if (profile.role !== 'admin') {
      return apiError('Исключительное право на удаление лидов имеет только администратор', 'FORBIDDEN', 403);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('lead_id')
      .eq('lead_id', id)
      .single();

    if (!existingLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    // Физическое удаление (Hard Delete) для роли admin.
    // select() возвращает удаленные строки: при запрете RLS удаление не даст ошибки, но вернет 0 строк
    const { data: deleted, error } = await supabase
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
