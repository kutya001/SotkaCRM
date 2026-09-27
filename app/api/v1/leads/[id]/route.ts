import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { LeadUpdateSchema, normalizeNullableUuid } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, profile } = await requireAuth();

    let query = supabase
      .from('leads')
      .select(
        `
          *,
          assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color),
          created_user:users!leads_created_by_fkey(user_id, full_name, role, color)
        `
      )
      .eq('lead_id', id)
      .single();

    const { data: lead, error } = await query;
    if (error || !lead) {
      return apiError('Лид не найден в системе', 'NOT_FOUND', 404);
    }

    if (profile.role === 'smm' && lead.created_by !== profile.user_id) {
      return apiError('Нет доступа к данному лиду', 'FORBIDDEN', 403);
    }
    if (profile.role === 'consultant' && lead.assigned_to !== profile.user_id) {
      return apiError('Лид назначен на другого консультанта', 'FORBIDDEN', 403);
    }

    return apiSuccess(lead);
  } catch (err) {
    return handleApiError(err);
  }
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
      .select('*')
      .eq('lead_id', id)
      .single();

    if (!existingLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (profile.role === 'smm') {
      if (existingLead.created_by !== profile.user_id) {
        return apiError('Роль SMM может редактировать только свои лиды', 'FORBIDDEN', 403);
      }
      if (body.assigned_to !== undefined && body.assigned_to !== existingLead.assigned_to) {
        return apiError('Роль SMM не имеет прав на назначение ответственного', 'FORBIDDEN', 403);
      }
    } else if (profile.role === 'consultant') {
      if (existingLead.assigned_to !== profile.user_id) {
        return apiError('Консультант может изменять только свои лиды', 'FORBIDDEN', 403);
      }
      if (body.assigned_to !== undefined && body.assigned_to !== existingLead.assigned_to) {
        return apiError('Консультанты не имеют прав на переназначение лидов', 'FORBIDDEN', 403);
      }
    }

    const sanitizedInput = {
      ...body,
      assigned_to: normalizeNullableUuid(body.assigned_to),
      country_code: body.country_code ? body.country_code.trim() : undefined,
      instagram: body.instagram && body.instagram.trim() !== '' ? body.instagram.trim() : null,
      comment: body.comment && body.comment.trim() !== '' ? body.comment.trim() : null,
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
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (valid.client_name !== undefined) updatePayload.client_name = valid.client_name.trim();
    if (valid.country_code !== undefined) updatePayload.country_code = valid.country_code;
    if (valid.instagram !== undefined) updatePayload.instagram = valid.instagram;
    if (valid.comment !== undefined) updatePayload.comment = valid.comment;
    if (valid.assigned_to !== undefined && profile.role === 'admin') {
      updatePayload.assigned_to = valid.assigned_to;
    }

    if (valid.phone) {
      const cleanPhone = valid.phone.replace(/\D/g, '');
      const phoneWithoutCode =
        cleanPhone.startsWith('996') && cleanPhone.length > 9
          ? cleanPhone.substring(3)
          : cleanPhone;
      updatePayload.phone = phoneWithoutCode;
    }

    const { data: updated, error } = await supabase
      .from('leads')
      .update(updatePayload as any)
      .eq('lead_id', id)
      .select(
        `
          *,
          assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color),
          created_user:users!leads_created_by_fkey(user_id, full_name, role, color)
        `
      )
      .single();

    if (error) throw error;

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

    if (profile.role === 'smm') {
      return apiError('Роль SMM не имеет прав на удаление/отмену лидов', 'FORBIDDEN', 403);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('lead_id, assigned_to, comment')
      .eq('lead_id', id)
      .single();

    if (!existingLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (profile.role === 'consultant' && existingLead.assigned_to !== profile.user_id) {
      return apiError('Лид назначен на другого консультанта', 'FORBIDDEN', 403);
    }

    // ВАЖНО: Физический DELETE запрещен триггером prevent_lead_delete (GEMINI.md).
    // Переводим лид в статус 'Отмена'
    const now = new Date().toLocaleDateString('ru-RU');
    const cancellationNote = `[Отмена (${now})]: Исключен пользователем ${profile.full_name}`;
    const updatedComment = existingLead.comment
      ? `${existingLead.comment}\n${cancellationNote}`
      : cancellationNote;

    const { error } = await supabase
      .from('leads')
      .update({
        status: 'Отмена',
        comment: updatedComment,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', id);

    if (error) throw error;

    return apiSuccess({ success: true, deleted_id: id, status: 'Отмена' });
  } catch (err) {
    return handleApiError(err);
  }
}
