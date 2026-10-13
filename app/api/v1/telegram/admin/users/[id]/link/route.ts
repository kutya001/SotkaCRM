import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeTelegramPrefs, type TelegramPrefs } from '@/lib/telegram/outbox';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

/** Администратор отвязывает Telegram сотрудника */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const admin = db();

    const { data: user } = await admin.from('users').select('user_id, telegram_chat_id').eq('user_id', id).maybeSingle();
    if (!user) return apiError('Сотрудник не найден', 'NOT_FOUND', 404);

    const { error } = await admin
      .from('users')
      .update({ telegram_chat_id: null, telegram_username: null, telegram_linked_at: null })
      .eq('user_id', id);
    if (error) throw error;
    await admin.from('telegram_link_codes').delete().eq('user_id', id).is('used_at', null);

    return apiSuccess({ success: true, was_linked: user.telegram_chat_id !== null });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Администратор меняет виды уведомлений сотрудника */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = (body?.prefs && typeof body.prefs === 'object' ? body.prefs : body) as Partial<TelegramPrefs>;

    const admin = db();
    const { data: current } = await admin.from('users').select('user_id, telegram_prefs').eq('user_id', id).maybeSingle();
    if (!current) return apiError('Сотрудник не найден', 'NOT_FOUND', 404);

    const merged = normalizeTelegramPrefs({ ...normalizeTelegramPrefs(current.telegram_prefs), ...input });
    const { error } = await admin.from('users').update({ telegram_prefs: merged }).eq('user_id', id);
    if (error) throw error;

    return apiSuccess({ prefs: merged });
  } catch (err) {
    return handleApiError(err);
  }
}
