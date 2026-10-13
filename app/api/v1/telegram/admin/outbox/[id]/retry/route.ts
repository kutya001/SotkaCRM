import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { isTelegramConfigured } from '@/lib/telegram/bot';
import { dispatchTelegramOutbox } from '@/lib/telegram/outbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

/** Повторная отправка сообщения (неуспешного или пропущенного) */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;

    if (!isTelegramConfigured()) {
      return apiError('Telegram-бот не настроен: задайте TELEGRAM_BOT_TOKEN', 'TELEGRAM_NOT_CONFIGURED', 503);
    }

    const admin = db();
    const { data: row, error } = await admin
      .from('telegram_outbox')
      .select('id, status, user_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return apiError('Сообщение не найдено', 'NOT_FOUND', 404);
    if (row.status === 'sending') return apiError('Сообщение уже отправляется', 'IN_PROGRESS', 409);

    const { error: updErr } = await admin
      .from('telegram_outbox')
      .update({ status: 'pending', attempts: 0, error: null, claimed_at: null, sent_at: null })
      .eq('id', id);
    if (updErr) throw updErr;

    const result = await dispatchTelegramOutbox(100);
    const { data: after } = await admin.from('telegram_outbox').select('status, error').eq('id', id).maybeSingle();

    return apiSuccess({ success: true, status: after?.status || 'pending', error: after?.error || null, dispatched: result });
  } catch (err) {
    return handleApiError(err);
  }
}
