/**
 * Комментарии к лидам с историей (миграция 048): кто и когда написал.
 * Последний комментарий хранится и в leads.comment (обновляет триггер БД) — его показывают
 * реестр и карточка лида. Права проверяет вызывающий код (canEditLeadComment, isLeadInScope).
 *
 * До применения миграции 048 таблицы lead_comments нет: список отдает текущий leads.comment
 * одной записью, а новый комментарий пишется прямо в leads.comment (без истории).
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingRelationError } from '@/lib/supabase/missing';

export const LEAD_COMMENT_MAX_LENGTH = 4000;

export interface LeadCommentAuthor {
  user_id: string;
  full_name: string;
  color: string | null;
}

export interface LeadCommentItem {
  comment_id: string;
  lead_id: string;
  body: string;
  created_at: string;
  /** Перенесен из прежнего поля «Комментарий» (автор неизвестен) */
  is_legacy: boolean;
  author: LeadCommentAuthor | null;
}

export interface LeadCommentsResult {
  comments: LeadCommentItem[];
  /** false — миграция 048 не применена, истории нет */
  history_available: boolean;
}

async function loadAuthors(ids: string[]): Promise<Map<string, LeadCommentAuthor>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data } = await createAdminClient().from('users').select('user_id, full_name, color').in('user_id', unique);
  return new Map((data || []).map((u) => [u.user_id, { user_id: u.user_id, full_name: u.full_name, color: u.color ?? null }]));
}

/** Лента комментариев лида: от старых к новым */
export async function listLeadComments(leadId: string): Promise<LeadCommentsResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('lead_comments')
    .select('comment_id, lead_id, author_id, body, is_legacy, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    if (!isMissingRelationError(error)) throw error;
    // Запасной режим: только текущий комментарий лида
    const { data: lead } = await admin.from('leads').select('lead_id, comment, updated_at').eq('lead_id', leadId).maybeSingle();
    const body = lead?.comment?.trim();
    return {
      history_available: false,
      comments: body
        ? [{ comment_id: `legacy-${leadId}`, lead_id: leadId, body, created_at: lead?.updated_at || '', is_legacy: true, author: null }]
        : [],
    };
  }

  const authors = await loadAuthors((data || []).map((c) => c.author_id || ''));
  return {
    history_available: true,
    comments: (data || []).map((c) => ({
      comment_id: c.comment_id,
      lead_id: c.lead_id,
      body: c.body,
      created_at: c.created_at,
      is_legacy: c.is_legacy,
      author: c.author_id ? authors.get(c.author_id) || null : null,
    })),
  };
}

/** Новый комментарий от имени сотрудника; триггер делает его последним комментарием лида */
export async function addLeadComment(
  leadId: string,
  authorId: string,
  body: string
): Promise<{ comment: LeadCommentItem; history_available: boolean }> {
  const text = body.trim();
  if (!text) throw new Error('Комментарий пустой');
  if (text.length > LEAD_COMMENT_MAX_LENGTH) {
    throw new Error(`Комментарий длиннее ${LEAD_COMMENT_MAX_LENGTH} символов`);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('lead_comments')
    .insert({ lead_id: leadId, author_id: authorId, body: text })
    .select('comment_id, lead_id, author_id, body, is_legacy, created_at')
    .single();

  const authors = await loadAuthors([authorId]);

  if (error) {
    if (!isMissingRelationError(error)) throw error;
    // Запасной режим до миграции 048: комментарий заменяет поле лида
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from('leads').update({ comment: text, updated_at: now }).eq('lead_id', leadId);
    if (updateError) throw updateError;
    return {
      history_available: false,
      comment: { comment_id: `legacy-${leadId}`, lead_id: leadId, body: text, created_at: now, is_legacy: false, author: authors.get(authorId) || null },
    };
  }

  return {
    history_available: true,
    comment: {
      comment_id: data.comment_id,
      lead_id: data.lead_id,
      body: data.body,
      created_at: data.created_at,
      is_legacy: data.is_legacy,
      author: authors.get(authorId) || null,
    },
  };
}
