import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const;
const KINDS = ['payroll', 'connections', 'leads', 'broadcast', 'system'] as const;

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

export interface TelegramOutboxItem {
  id: string;
  user_id: string | null;
  kind: string;
  title: string;
  body: string;
  status: string;
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  recipient: { user_id: string; full_name: string; login: string; role: string; color: string | null } | null;
}

/** Журнал сообщений Telegram (очередь и отправленные) */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const admin = db();
    const { searchParams } = req.nextUrl;

    const status = searchParams.get('status');
    const kind = searchParams.get('kind');
    const userId = searchParams.get('user_id');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 2000);

    let query = admin
      .from('telegram_outbox')
      .select('id, user_id, kind, title, body, status, attempts, error, created_at, sent_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
    if (kind && (KINDS as readonly string[]).includes(kind)) query = query.eq('kind', kind);
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as Omit<TelegramOutboxItem, 'recipient'>[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id))));
    const { data: users } = userIds.length
      ? await admin.from('users').select('user_id, full_name, login, role, color').in('user_id', userIds)
      : { data: [] as any[] };
    const usersMap = new Map<string, TelegramOutboxItem['recipient']>(
      ((users || []) as any[]).map((u) => [u.user_id, { user_id: u.user_id, full_name: u.full_name, login: u.login, role: u.role, color: u.color ?? null }])
    );

    const items: TelegramOutboxItem[] = rows.map((r) => ({
      ...r,
      recipient: r.user_id ? usersMap.get(r.user_id) || null : null,
    }));

    return apiSuccess({ items, total: items.length });
  } catch (err) {
    return handleApiError(err);
  }
}
