import { createHash, randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from './bot';

/**
 * Восстановление пароля через Telegram: одноразовый код приходит в привязанный чат,
 * пользователь вводит его на странице входа вместе с новым паролем.
 * В БД хранится только хеш кода; код действует 10 минут, 5 попыток ввода,
 * новый код не чаще раза в минуту.
 */

export const RESET_CODE_TTL_MINUTES = 10;
const RESET_CODE_MIN_INTERVAL_SEC = 60;
const RESET_MAX_ATTEMPTS = 5;

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

export function normalizeLogin(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/@internal\.sotka\.kg$/, '');
}

function hashCode(userId: string, code: string): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'sotka';
  return createHash('sha256').update(`${userId}:${code}:${secret}`).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

interface ResetUser {
  user_id: string;
  auth_id: string | null;
  login: string;
  full_name: string;
  is_active: boolean;
  telegram_chat_id: number | null;
}

async function findUserByLogin(login: string): Promise<ResetUser | null> {
  const { data } = await db()
    .from('users')
    .select('user_id, auth_id, login, full_name, is_active, telegram_chat_id')
    .eq('login', login)
    .maybeSingle();
  return (data as ResetUser | null) || null;
}

async function findUserByChat(chatId: number): Promise<ResetUser | null> {
  const { data } = await db()
    .from('users')
    .select('user_id, auth_id, login, full_name, is_active, telegram_chat_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
  return (data as ResetUser | null) || null;
}

/** Создает код для пользователя (с учетом лимита частоты). Возвращает код или null, если рано */
async function issueCode(user: ResetUser): Promise<{ code: string; expiresAt: string } | null> {
  const admin = db();
  const { data: last } = await admin
    .from('telegram_password_resets')
    .select('created_at')
    .eq('user_id', user.user_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.created_at).getTime() < RESET_CODE_MIN_INTERVAL_SEC * 1000) {
    return null;
  }

  // Старые неиспользованные коды отзываются
  await admin.from('telegram_password_resets').update({ used_at: new Date().toISOString() }).eq('user_id', user.user_id).is('used_at', null);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000).toISOString();
  const { error } = await admin
    .from('telegram_password_resets')
    .insert({ user_id: user.user_id, code_hash: hashCode(user.user_id, code), expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return { code, expiresAt };
}

function codeMessage(code: string, login: string): string {
  return (
    `<b>Восстановление пароля SotkaCRM</b>\n` +
    `Код: <code>${code}</code>\n` +
    `Логин: ${escapeTelegramHtml(login)}\n` +
    `Код действует ${RESET_CODE_TTL_MINUTES} минут. Введите его на странице входа → «Забыли пароль?».\n` +
    `Если вы не запрашивали восстановление — просто проигнорируйте это сообщение.`
  );
}

export type RequestResetResult =
  | { status: 'sent'; expiresAt: string }
  | { status: 'not_linked' }
  | { status: 'not_found' }
  | { status: 'inactive' }
  | { status: 'too_soon' }
  | { status: 'not_configured' };

/** Запрос кода со страницы входа по логину */
export async function requestPasswordResetByLogin(rawLogin: string): Promise<RequestResetResult> {
  if (!isTelegramConfigured()) return { status: 'not_configured' };
  const login = normalizeLogin(rawLogin);
  if (!login) return { status: 'not_found' };

  const user = await findUserByLogin(login);
  if (!user) return { status: 'not_found' };
  if (!user.is_active) return { status: 'inactive' };
  if (!user.telegram_chat_id) return { status: 'not_linked' };

  const issued = await issueCode(user);
  if (!issued) return { status: 'too_soon' };

  await sendTelegramMessage(user.telegram_chat_id, codeMessage(issued.code, user.login));
  return { status: 'sent', expiresAt: issued.expiresAt };
}

/** Запрос кода командой /password из привязанного чата бота */
export async function requestPasswordResetByChat(chatId: number): Promise<RequestResetResult & { login?: string }> {
  const user = await findUserByChat(chatId);
  if (!user) return { status: 'not_linked' };
  if (!user.is_active) return { status: 'inactive' };
  const issued = await issueCode(user);
  if (!issued) return { status: 'too_soon', login: user.login };
  await sendTelegramMessage(chatId, codeMessage(issued.code, user.login));
  return { status: 'sent', expiresAt: issued.expiresAt, login: user.login };
}

export type ConfirmResetResult =
  | { status: 'ok' }
  | { status: 'invalid_code'; attemptsLeft: number }
  | { status: 'expired' }
  | { status: 'not_found' };

/** Проверка кода и установка нового пароля */
export async function confirmPasswordReset(rawLogin: string, rawCode: string, newPassword: string): Promise<ConfirmResetResult> {
  const login = normalizeLogin(rawLogin);
  const code = String(rawCode ?? '').replace(/\D/g, '');
  const user = login ? await findUserByLogin(login) : null;
  if (!user || !user.is_active || !user.auth_id) return { status: 'not_found' };

  const admin = db();
  const { data: reset } = await admin
    .from('telegram_password_resets')
    .select('id, code_hash, attempts, expires_at')
    .eq('user_id', user.user_id)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!reset) return { status: 'expired' };
  if (new Date(reset.expires_at).getTime() < Date.now() || reset.attempts >= RESET_MAX_ATTEMPTS) {
    await admin.from('telegram_password_resets').update({ used_at: new Date().toISOString() }).eq('id', reset.id);
    return { status: 'expired' };
  }

  if (code.length !== 6 || hashCode(user.user_id, code) !== reset.code_hash) {
    const attempts = reset.attempts + 1;
    const exhausted = attempts >= RESET_MAX_ATTEMPTS;
    await admin
      .from('telegram_password_resets')
      .update({ attempts, ...(exhausted ? { used_at: new Date().toISOString() } : {}) })
      .eq('id', reset.id);
    return exhausted ? { status: 'expired' } : { status: 'invalid_code', attemptsLeft: RESET_MAX_ATTEMPTS - attempts };
  }

  const { error: authError } = await createAdminClient().auth.admin.updateUserById(user.auth_id, { password: newPassword });
  if (authError) throw new Error(authError.message);

  await admin.from('telegram_password_resets').update({ used_at: new Date().toISOString() }).eq('user_id', user.user_id).is('used_at', null);

  if (user.telegram_chat_id) {
    try {
      await sendTelegramMessage(
        user.telegram_chat_id,
        `<b>Пароль SotkaCRM изменен</b>\nЛогин: ${escapeTelegramHtml(user.login)}\nЕсли это были не вы — немедленно сообщите администратору.`
      );
    } catch (err) {
      console.warn('[Telegram] Уведомление о смене пароля не доставлено:', (err as Error).message);
    }
  }

  return { status: 'ok' };
}
