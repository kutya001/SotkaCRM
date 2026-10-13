import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelegramBotInfo, getTelegramWebhookSecret, isTelegramConfigured, telegramCall } from '@/lib/telegram/bot';
import { normalizeTelegramPrefs, type TelegramPrefs } from '@/lib/telegram/outbox';
import type { UserRole } from '@/types/database.types';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

export interface TelegramEmployeeLink {
  user_id: string;
  full_name: string;
  login: string;
  role: UserRole;
  color: string | null;
  is_active: boolean;
  linked: boolean;
  username: string | null;
  linked_at: string | null;
  prefs: TelegramPrefs;
  sent_count: number;
  last_sent_at: string | null;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
}

/** Сводка модуля Telegram: бот, вебхук, очередь, привязки сотрудников */
export async function GET() {
  try {
    await requireAdmin();
    const admin = db();
    const configured = isTelegramConfigured();

    const [bot, webhook, { data: users }, { data: outboxRows }] = await Promise.all([
      getTelegramBotInfo(),
      configured
        ? telegramCall<WebhookInfo>('getWebhookInfo').catch((err: Error) => ({ error: err.message } as WebhookInfo & { error: string }))
        : Promise.resolve(null),
      admin
        .from('users')
        .select('user_id, full_name, login, role, color, is_active, telegram_chat_id, telegram_username, telegram_linked_at, telegram_prefs')
        .order('full_name'),
      admin.from('telegram_outbox').select('user_id, status, sent_at, created_at'),
    ]);

    const rows = (outboxRows || []) as { user_id: string | null; status: string; sent_at: string | null; created_at: string }[];
    const byStatus: Record<string, number> = {};
    const sentByUser = new Map<string, { count: number; last: string | null }>();
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      if (row.status === 'sent' && row.user_id) {
        const cur = sentByUser.get(row.user_id) || { count: 0, last: null };
        cur.count++;
        const at = row.sent_at || row.created_at;
        if (!cur.last || at > cur.last) cur.last = at;
        sentByUser.set(row.user_id, cur);
      }
    }

    const employees: TelegramEmployeeLink[] = ((users || []) as any[]).map((u) => ({
      user_id: u.user_id,
      full_name: u.full_name,
      login: u.login,
      role: u.role,
      color: u.color ?? null,
      is_active: Boolean(u.is_active),
      linked: u.telegram_chat_id !== null && u.telegram_chat_id !== undefined,
      username: u.telegram_username ?? null,
      linked_at: u.telegram_linked_at ?? null,
      prefs: normalizeTelegramPrefs(u.telegram_prefs),
      sent_count: sentByUser.get(u.user_id)?.count || 0,
      last_sent_at: sentByUser.get(u.user_id)?.last || null,
    }));

    const webhookInfo = (webhook || {}) as WebhookInfo & { error?: string };

    return apiSuccess({
      configured,
      bot: bot ? { username: bot.username, name: bot.first_name } : null,
      webhook: configured
        ? {
            url: webhookInfo.url || null,
            secret_configured: Boolean(getTelegramWebhookSecret()),
            pending_updates: webhookInfo.pending_update_count ?? 0,
            last_error: webhookInfo.last_error_message || webhookInfo.error || null,
            last_error_at: webhookInfo.last_error_date ? new Date(webhookInfo.last_error_date * 1000).toISOString() : null,
          }
        : null,
      outbox: {
        total: rows.length,
        pending: (byStatus.pending || 0) + (byStatus.sending || 0),
        sent: byStatus.sent || 0,
        failed: byStatus.failed || 0,
        skipped: byStatus.skipped || 0,
      },
      employees,
      linked_total: employees.filter((e) => e.linked && e.is_active).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
