import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { canEditLeadComment, isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';
import { LEAD_COMMENT_MAX_LENGTH, addLeadComment, listLeadComments } from '@/lib/services/lead-comments';

const CommentSchema = z.object({
  body: z
    .string({ error: 'Введите текст комментария' })
    .trim()
    .min(1, 'Введите текст комментария')
    .max(LEAD_COMMENT_MAX_LENGTH, `Комментарий длиннее ${LEAD_COMMENT_MAX_LENGTH} символов`),
});

async function loadLeadScope(id: string) {
  const { data } = await createAdminClient()
    .from('leads')
    .select('lead_id, created_by, assigned_to')
    .eq('lead_id', id)
    .maybeSingle();
  return data;
}

/** Лента комментариев лида (от старых к новым) с авторами */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.menu');
    const lead = await loadLeadScope(id);
    if (!lead) return apiError('Лид не найден', 'NOT_FOUND', 404);
    if (!isLeadInScope(leadActorFrom(ctx), lead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    const result = await listLeadComments(id);
    return apiSuccess({ ...result, can_comment: canEditLeadComment(leadActorFrom(ctx), lead) });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Новый комментарий от имени текущего сотрудника (ответственный, создатель или с правом видеть все лиды) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireAuth();
    const actor = leadActorFrom(ctx);
    const lead = await loadLeadScope(id);
    if (!lead) return apiError('Лид не найден', 'NOT_FOUND', 404);
    if (!canEditLeadComment(actor, lead)) {
      return apiError('Недостаточно прав для комментария к этому лиду', 'FORBIDDEN', 403);
    }

    const parsed = CommentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const result = await addLeadComment(id, ctx.profile.user_id, parsed.data.body);
    return apiSuccess(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
