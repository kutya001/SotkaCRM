import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelegramBotInfo, isTelegramConfigured, telegramDeepLink } from '@/lib/telegram/bot';
import { normalizeTelegramPrefs, type TelegramPrefs } from '@/lib/telegram/outbox';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

/** Состояние подключения Telegram текущего сотрудника */
export async function GET() {
  try {
    const { profile } = await requireAuth();
    const admin = db();

    const [{ data: user }, bot] = await Promise.all([
      admin
        .from('users')
        .select('telegram_chat_id, telegram_username, telegram_linked_at, telegram_prefs')
        .eq('user_id', profile.user_id)
        .maybeSingle(),
      getTelegramBotInfo(),
    ]);

    let pending: { code: string; deep_link: string | null; expires_at: string } | null = null;
    if (!user?.telegram_chat_id) {
      const { data: code } = await admin
        .from('telegram_link_codes')
        .select('code, expires_at')
        .eq('user_id', profile.user_id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (code) {
        pending = {
          code: code.code,
          deep_link: bot ? telegramDeepLink(bot.username, code.code) : null,
          expires_at: code.expires_at,
        };
      }
    }

    return apiSuccess({
      configured: isTelegramConfigured(),
      bot_username: bot?.username || null,
      linked: Boolean(user?.telegram_chat_id),
      username: user?.telegram_username || null,
      linked_at: user?.telegram_linked_at || null,
      prefs: normalizeTelegramPrefs(user?.telegram_prefs),
      pending,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Настройки видов уведомлений текущего сотрудника */
export async function PATCH(req: NextRequest) {
  try {
    const { profile } = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const input = (body?.prefs && typeof body.prefs === 'object' ? body.prefs : body) as Partial<TelegramPrefs>;

    const admin = db();
    const { data: current } = await admin
      .from('users')
      .select('telegram_prefs')
      .eq('user_id', profile.user_id)
      .maybeSingle();

    const merged = normalizeTelegramPrefs({ ...normalizeTelegramPrefs(current?.telegram_prefs), ...input });
    const { error } = await admin.from('users').update({ telegram_prefs: merged }).eq('user_id', profile.user_id);
    if (error) return apiError(error.message, 'UPDATE_FAILED', 500);

    return apiSuccess({ prefs: merged });
  } catch (err) {
    return handleApiError(err);
  }
}
