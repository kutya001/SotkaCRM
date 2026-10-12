import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ensureTelegramWebhook,
  getTelegramBotInfo,
  isTelegramConfigured,
  resolveAppBaseUrl,
  telegramDeepLink,
} from '@/lib/telegram/bot';

const CODE_TTL_MINUTES = 15;
// Без похожих символов (0/O, 1/I): код можно надиктовать или набрать вручную
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

/** Выдать код привязки и ссылку на бота */
export async function POST(req: NextRequest) {
  try {
    const { profile } = await requireAuth();

    if (!isTelegramConfigured()) {
      return apiError('Telegram-бот не настроен: задайте TELEGRAM_BOT_TOKEN', 'TELEGRAM_NOT_CONFIGURED', 503);
    }

    const bot = await getTelegramBotInfo();
    if (!bot) {
      return apiError('Telegram Bot API недоступен или токен бота неверный', 'TELEGRAM_UNAVAILABLE', 502);
    }

    // Вебхук регистрируется на публичном адресе приложения (только https, боевая среда)
    const isProductionLike = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === 'production' : true;
    const webhook = isProductionLike
      ? await ensureTelegramWebhook(resolveAppBaseUrl(req.nextUrl.origin))
      : { ok: false, reason: 'preview' };
    if (!webhook.ok) {
      console.warn('[Telegram] Вебхук не зарегистрирован:', webhook.reason);
    }

    const admin = db();
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    // Старые неиспользованные коды сотрудника отзываются
    await admin.from('telegram_link_codes').delete().eq('user_id', profile.user_id).is('used_at', null);
    const { error } = await admin
      .from('telegram_link_codes')
      .insert({ code, user_id: profile.user_id, expires_at: expiresAt });
    if (error) return apiError(error.message, 'CODE_CREATE_FAILED', 500);

    return apiSuccess({
      code,
      bot_username: bot.username,
      deep_link: telegramDeepLink(bot.username, code),
      expires_at: expiresAt,
      webhook_ok: webhook.ok,
      webhook_reason: webhook.ok ? null : webhook.reason || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Отвязать Telegram текущего сотрудника */
export async function DELETE() {
  try {
    const { profile } = await requireAuth();
    const admin = db();
    const { error } = await admin
      .from('users')
      .update({ telegram_chat_id: null, telegram_username: null, telegram_linked_at: null })
      .eq('user_id', profile.user_id);
    if (error) return apiError(error.message, 'UNLINK_FAILED', 500);
    await admin.from('telegram_link_codes').delete().eq('user_id', profile.user_id).is('used_at', null);
    return apiSuccess({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
