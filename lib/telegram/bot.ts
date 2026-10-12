/**
 * Клиент Telegram Bot API для уведомлений сотрудников.
 * Токен бота и секрет вебхука берутся из переменных окружения
 * TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET (только на сервере).
 */

const API_BASE = 'https://api.telegram.org';

export interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
}

export class TelegramApiError extends Error {
  readonly status: number;
  readonly description: string;

  constructor(method: string, status: number, description: string) {
    super(`Telegram ${method} [${status}]: ${description}`);
    this.name = 'TelegramApiError';
    this.status = status;
    this.description = description;
  }

  /** Пользователь заблокировал бота или чат больше не существует — слать некуда */
  get isChatGone(): boolean {
    return (
      this.status === 403 ||
      (this.status === 400 && /chat not found|user is deactivated|chat_id is empty/i.test(this.description))
    );
  }
}

export function getTelegramToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? token : null;
}

export function getTelegramWebhookSecret(): string | null {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return secret ? secret : null;
}

export function isTelegramConfigured(): boolean {
  return getTelegramToken() !== null;
}

/** Вызов метода Bot API; при ok=false выбрасывает TelegramApiError */
export async function telegramCall<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = getTelegramToken();
  if (!token) {
    throw new TelegramApiError(method, 0, 'TELEGRAM_BOT_TOKEN не задан');
  }

  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });

  let json: { ok?: boolean; result?: T; description?: string; error_code?: number } = {};
  try {
    json = await response.json();
  } catch {
    throw new TelegramApiError(method, response.status, response.statusText || 'пустой ответ');
  }

  if (!response.ok || !json.ok) {
    throw new TelegramApiError(method, json.error_code || response.status, json.description || 'unknown error');
  }

  return json.result as T;
}

/** Экранирование текста для parse_mode=HTML */
export function escapeTelegramHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Заголовок жирным + тело (уже экранировано) */
export function formatTelegramMessage(title: string, body?: string | null): string {
  const head = `<b>${escapeTelegramHtml(title)}</b>`;
  const rest = body ? `\n${escapeTelegramHtml(body)}` : '';
  return `${head}${rest}`;
}

export async function sendTelegramMessage(
  chatId: number | string,
  html: string,
  options: { disableNotification?: boolean } = {}
): Promise<{ message_id: number }> {
  return telegramCall<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: options.disableNotification ?? false,
  });
}

// Информация о боте меняется только при смене токена — кэшируется в памяти инстанса
let botInfoCache: { info: TelegramBotInfo; loadedAt: number } | null = null;
const BOT_INFO_TTL_MS = 10 * 60 * 1000;

export async function getTelegramBotInfo(): Promise<TelegramBotInfo | null> {
  if (!isTelegramConfigured()) return null;
  if (botInfoCache && Date.now() - botInfoCache.loadedAt < BOT_INFO_TTL_MS) {
    return botInfoCache.info;
  }
  try {
    const info = await telegramCall<TelegramBotInfo>('getMe');
    botInfoCache = { info, loadedAt: Date.now() };
    return info;
  } catch (err) {
    console.warn('[Telegram] getMe недоступен:', (err as Error).message);
    return null;
  }
}

/** Ссылка «открыть бота с кодом привязки» */
export function telegramDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(code)}`;
}

/** Публичный адрес приложения для вебхука: NEXT_PUBLIC_APP_URL, иначе origin запроса */
export function resolveAppBaseUrl(requestOrigin?: string | null): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (configured && /^https:\/\//.test(configured)) return configured;
  if (requestOrigin && /^https:\/\//.test(requestOrigin)) return requestOrigin.replace(/\/+$/, '');
  return null;
}

let webhookEnsuredFor: string | null = null;

/**
 * Регистрирует вебхук бота на этом приложении, если он еще не зарегистрирован.
 * Telegram принимает только https, поэтому локальная разработка пропускается.
 * Результат кэшируется на время жизни инстанса.
 */
export async function ensureTelegramWebhook(
  baseUrl: string | null
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  if (!isTelegramConfigured()) return { ok: false, reason: 'TELEGRAM_BOT_TOKEN не задан' };
  if (!baseUrl) return { ok: false, reason: 'Не определен публичный https-адрес приложения' };

  const secret = getTelegramWebhookSecret();
  if (!secret) return { ok: false, reason: 'TELEGRAM_WEBHOOK_SECRET не задан' };

  const url = `${baseUrl}/api/telegram/webhook`;
  if (webhookEnsuredFor === url) return { ok: true, url };

  try {
    const current = await telegramCall<{ url?: string }>('getWebhookInfo');
    if (current.url !== url) {
      await telegramCall('setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'my_chat_member'],
        drop_pending_updates: false,
      });
    }
    webhookEnsuredFor = url;
    return { ok: true, url };
  } catch (err) {
    return { ok: false, url, reason: (err as Error).message };
  }
}
