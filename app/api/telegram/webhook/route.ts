import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  escapeTelegramHtml,
  getTelegramWebhookSecret,
  isTelegramConfigured,
  sendTelegramMessage,
} from '@/lib/telegram/bot';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';

export const dynamic = 'force-dynamic';

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
  };
  my_chat_member?: {
    chat: { id: number };
    new_chat_member?: { status?: string };
  };
}

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

const HELP_TEXT =
  '<b>SotkaCRM</b>\n' +
  'Этот бот присылает уведомления сотрудникам CRM: начисления и выплаты, новые подключения, назначенные лиды, сообщения администратора.\n\n' +
  'Чтобы подключить уведомления, откройте в CRM <b>Профиль → Telegram</b> и нажмите «Подключить» — бот откроется с кодом привязки.\n\n' +
  'Команды:\n/status — состояние подключения\n/stop — отключить уведомления';

async function reply(chatId: number, html: string) {
  try {
    await sendTelegramMessage(chatId, html);
  } catch (err) {
    console.warn('[Telegram webhook] Ответ не доставлен:', (err as Error).message);
  }
}

async function handleStart(chatId: number, code: string | undefined, username: string | undefined) {
  if (!code) {
    await reply(chatId, HELP_TEXT);
    return;
  }

  const { data, error } = await db().rpc('telegram_link_account', {
    p_code: code,
    p_chat_id: chatId,
    p_username: username || null,
  });

  const res = (data || {}) as { success?: boolean; error?: string; full_name?: string };
  if (error || !res.success) {
    const reason =
      res.error === 'code_expired'
        ? 'Код привязки устарел. Получите новый в CRM: Профиль → Telegram → «Подключить».'
        : res.error === 'code_used'
        ? 'Этот код уже использован. Получите новый в CRM: Профиль → Telegram.'
        : res.error === 'user_inactive'
        ? 'Учетная запись в CRM заблокирована — обратитесь к администратору.'
        : 'Код привязки не найден. Получите новый в CRM: Профиль → Telegram → «Подключить».';
    await reply(chatId, `❌ ${escapeTelegramHtml(reason)}`);
    return;
  }

  await reply(
    chatId,
    `✅ <b>Telegram подключен</b>\nСотрудник: ${escapeTelegramHtml(res.full_name || '')}\n\n` +
      'Сюда будут приходить уведомления о начислениях и выплатах, подключениях, назначенных лидах и сообщения администратора. ' +
      'Виды уведомлений можно настроить в CRM: Профиль → Telegram.'
  );
}

async function unlinkChat(chatId: number): Promise<boolean> {
  const { data } = await db()
    .from('users')
    .update({ telegram_chat_id: null, telegram_username: null, telegram_linked_at: null })
    .eq('telegram_chat_id', chatId)
    .select('user_id');
  return (data || []).length > 0;
}

async function handleStatus(chatId: number) {
  const { data } = await db()
    .from('users')
    .select('full_name, is_active, telegram_linked_at')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!data) {
    await reply(chatId, 'Чат не привязан к сотруднику CRM.\n\n' + HELP_TEXT);
    return;
  }
  const since = data.telegram_linked_at
    ? new Date(data.telegram_linked_at).toLocaleDateString('ru-RU')
    : '—';
  await reply(
    chatId,
    `✅ Подключено: <b>${escapeTelegramHtml(data.full_name)}</b>\nС ${since}${data.is_active ? '' : '\n⚠️ Учетная запись заблокирована'}`
  );
}

/**
 * Вебхук Telegram. Подлинность запроса подтверждает заголовок
 * X-Telegram-Bot-Api-Secret-Token (секрет передается при setWebhook).
 * Всегда отвечает 200, иначе Telegram будет повторять доставку.
 */
export async function POST(req: NextRequest) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }

  const secret = getTelegramWebhookSecret();
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    // Пользователь удалил чат с ботом или заблокировал его
    if (update.my_chat_member?.new_chat_member?.status === 'kicked') {
      await unlinkChat(update.my_chat_member.chat.id);
      return NextResponse.json({ ok: true });
    }

    const message = update.message;
    if (!message || message.chat.type !== 'private') {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    const [command, ...args] = text.split(/\s+/);
    const cmd = command.toLowerCase().replace(/@.*$/, '');

    if (cmd === '/start') {
      await handleStart(chatId, args[0], message.from?.username);
      scheduleTelegramDispatch();
    } else if (cmd === '/stop' || cmd === '/unlink') {
      const was = await unlinkChat(chatId);
      await reply(chatId, was ? 'Уведомления отключены. Подключить снова: CRM → Профиль → Telegram.' : 'Чат не был привязан к CRM.');
    } else if (cmd === '/status') {
      await handleStatus(chatId);
    } else {
      await reply(chatId, HELP_TEXT);
    }
  } catch (err) {
    console.error('[Telegram webhook] Ошибка обработки обновления:', err);
  }

  return NextResponse.json({ ok: true });
}
