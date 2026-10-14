import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  TelegramApiError,
  formatTelegramMessage,
  isTelegramConfigured,
  sendTelegramMessage,
} from './bot';
import type { UserRole } from '@/types/database.types';

export type TelegramKind = 'payroll' | 'connections' | 'leads' | 'tasks' | 'broadcast' | 'system';

export const TELEGRAM_KIND_LABELS: Record<Exclude<TelegramKind, 'system'>, string> = {
  payroll: 'Операции по ЗП: начисления, удержания, выплаты',
  connections: 'Подтвержденные и отклоненные подключения',
  leads: 'Назначенные лиды',
  tasks: 'Назначенные задачи',
  broadcast: 'Сообщения администратора',
};

export interface TelegramPrefs {
  payroll: boolean;
  connections: boolean;
  leads: boolean;
  tasks: boolean;
  broadcast: boolean;
}

export const DEFAULT_TELEGRAM_PREFS: TelegramPrefs = {
  payroll: true,
  connections: true,
  leads: true,
  tasks: true,
  broadcast: true,
};

export function normalizeTelegramPrefs(raw: unknown): TelegramPrefs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    payroll: src.payroll !== false,
    connections: src.connections !== false,
    leads: src.leads !== false,
    tasks: src.tasks !== false,
    broadcast: src.broadcast !== false,
  };
}

interface OutboxRow {
  id: string;
  user_id: string | null;
  kind: TelegramKind;
  title: string;
  body: string;
  attempts: number;
}

interface LinkedUser {
  user_id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  telegram_chat_id: number | null;
  telegram_prefs: unknown;
}

const MAX_ATTEMPTS = 3;

/** Таблицы Telegram не описаны в сгенерированных типах — работаем через нетипизированный клиент */
function telegramDb(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
}

/**
 * Отправляет накопившиеся сообщения очереди. Безопасно вызывать параллельно:
 * пачка захватывается в БД (telegram_claim_outbox), повторный захват исключен.
 */
export async function dispatchTelegramOutbox(limit = 50): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, failed: 0, skipped: 0, deferred: 0 };
  if (!isTelegramConfigured()) return result;

  const db = telegramDb();
  const { data: rows, error } = await db.rpc('telegram_claim_outbox', { p_limit: limit });
  if (error) {
    console.error('[Telegram] Не удалось захватить очередь:', error.message);
    return result;
  }

  const batch = (rows || []) as OutboxRow[];
  result.claimed = batch.length;
  if (batch.length === 0) return result;

  const userIds = Array.from(new Set(batch.map((r) => r.user_id).filter((id): id is string => Boolean(id))));
  const { data: users } = await db
    .from('users')
    .select('user_id, full_name, role, is_active, telegram_chat_id, telegram_prefs')
    .in('user_id', userIds);
  const usersMap = new Map<string, LinkedUser>((users || []).map((u: LinkedUser) => [u.user_id, u]));

  for (const row of batch) {
    const user = row.user_id ? usersMap.get(row.user_id) : undefined;
    const prefs = normalizeTelegramPrefs(user?.telegram_prefs);
    const kindAllowed = row.kind === 'system' || prefs[row.kind as keyof TelegramPrefs] !== false;

    if (!user || !user.is_active || !user.telegram_chat_id || !kindAllowed) {
      await db
        .from('telegram_outbox')
        .update({ status: 'skipped', error: !user?.telegram_chat_id ? 'Telegram не подключен' : 'Отключено в настройках' })
        .eq('id', row.id);
      result.skipped++;
      continue;
    }

    try {
      await sendTelegramMessage(user.telegram_chat_id, formatTelegramMessage(row.title, row.body));
      await db
        .from('telegram_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', row.id);
      result.sent++;
    } catch (err) {
      const apiErr = err instanceof TelegramApiError ? err : null;

      if (apiErr?.isChatGone) {
        // Бот заблокирован — отвязываем, чтобы интерфейс показывал реальное состояние
        await db
          .from('users')
          .update({ telegram_chat_id: null, telegram_username: null, telegram_linked_at: null })
          .eq('user_id', user.user_id);
        await db.from('telegram_outbox').update({ status: 'failed', error: apiErr.description }).eq('id', row.id);
        result.failed++;
        continue;
      }

      if (apiErr?.status === 429) {
        // Лимит Telegram: вернуть в очередь и прекратить пачку
        await db.from('telegram_outbox').update({ status: 'pending', error: apiErr.description }).eq('id', row.id);
        result.deferred++;
        break;
      }

      const message = (err as Error).message || 'Ошибка отправки';
      const exhausted = row.attempts >= MAX_ATTEMPTS;
      await db
        .from('telegram_outbox')
        .update({ status: exhausted ? 'failed' : 'pending', error: message })
        .eq('id', row.id);
      if (exhausted) result.failed++;
      else result.deferred++;
    }
  }

  return result;
}

/**
 * Отправка очереди после ответа клиенту (next/server after). Вне контекста запроса
 * выполняется в фоне сразу. Ошибки только логируются: уведомления не должны ломать операцию.
 */
export function scheduleTelegramDispatch(): void {
  if (!isTelegramConfigured()) return;
  const run = () =>
    dispatchTelegramOutbox().catch((err) => console.error('[Telegram] Ошибка отправки очереди:', err));
  try {
    after(run);
  } catch {
    void run();
  }
}

export interface BroadcastInput {
  title: string;
  body: string;
  roles?: UserRole[];
}

/** Сообщение администратора всем подключенным сотрудникам (или выбранным ролям) */
export async function enqueueTelegramBroadcast(input: BroadcastInput): Promise<{ queued: number }> {
  const db = telegramDb();
  let query = db
    .from('users')
    .select('user_id, telegram_prefs')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null);
  if (input.roles && input.roles.length > 0) {
    query = query.in('role', input.roles);
  }
  const { data: users, error } = await query;
  if (error) throw new Error(error.message);

  const recipients = (users || []).filter((u: { telegram_prefs: unknown }) => normalizeTelegramPrefs(u.telegram_prefs).broadcast);
  if (recipients.length === 0) return { queued: 0 };

  const rows = recipients.map((u: { user_id: string }) => ({
    user_id: u.user_id,
    kind: 'broadcast',
    title: input.title,
    body: input.body,
  }));
  const { error: insertError } = await db.from('telegram_outbox').insert(rows);
  if (insertError) throw new Error(insertError.message);

  return { queued: rows.length };
}

/** Количество подключенных к Telegram сотрудников по ролям */
export async function countTelegramLinkedByRole(): Promise<Record<string, number>> {
  const db = telegramDb();
  const { data } = await db
    .from('users')
    .select('role')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null);
  const counts: Record<string, number> = {};
  for (const u of (data || []) as { role: string }[]) {
    counts[u.role] = (counts[u.role] || 0) + 1;
  }
  return counts;
}
