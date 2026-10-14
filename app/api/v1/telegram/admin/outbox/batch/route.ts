import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { PG_UUID_REGEX } from '@/lib/validations';
import { isTelegramConfigured } from '@/lib/telegram/bot';
import { dispatchTelegramOutbox } from '@/lib/telegram/outbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

const OutboxBatchSchema = z.object({
  action: z.enum(['retry', 'delete']),
  ids: z
    .array(z.string().regex(PG_UUID_REGEX, 'Неверный идентификатор сообщения'))
    .min(1, 'Выберите хотя бы одно сообщение')
    .max(500, 'За один раз можно обработать не более 500 сообщений'),
});

/** Статусы, из которых сообщение можно отправить повторно */
const RETRYABLE_STATUSES = ['failed', 'skipped', 'pending'];

/**
 * Массовые действия над журналом сообщений (telegram.manage):
 *  - retry: вернуть неотправленные (failed/skipped/pending) в очередь и отправить очередь
 *  - delete: удалить записи журнала
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermission('telegram.manage');
    const body = await req.json().catch(() => ({}));

    const parsed = OutboxBatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации пакетной операции', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const { action } = parsed.data;
    const ids = Array.from(new Set(parsed.data.ids));
    const admin = db();

    if (action === 'delete') {
      const { data, error } = await admin.from('telegram_outbox').delete().in('id', ids).select('id');
      if (error) throw error;
      return apiSuccess({ success: true, action, affected: data?.length || 0 });
    }

    if (action === 'retry') {
      if (!isTelegramConfigured()) {
        return apiError('Telegram-бот не настроен: задайте TELEGRAM_BOT_TOKEN', 'TELEGRAM_NOT_CONFIGURED', 503);
      }

      // Как в /outbox/[id]/retry: сброс попыток и возврат в очередь, затем отправка очереди
      const { data: rows, error: readError } = await admin
        .from('telegram_outbox')
        .select('id, status')
        .in('id', ids)
        .in('status', RETRYABLE_STATUSES);
      if (readError) throw readError;

      const retryIds = (rows || []).map((r: { id: string }) => r.id);
      if (retryIds.length === 0) {
        return apiSuccess({ success: true, action, affected: 0, sent: 0, failed: 0 });
      }

      const { error: updErr } = await admin
        .from('telegram_outbox')
        .update({ status: 'pending', attempts: 0, error: null, claimed_at: null, sent_at: null })
        .in('id', retryIds);
      if (updErr) throw updErr;

      const dispatched = await dispatchTelegramOutbox(Math.min(500, Math.max(100, retryIds.length)));

      const { data: after } = await admin.from('telegram_outbox').select('id, status').in('id', retryIds);
      const statuses = (after || []) as { id: string; status: string }[];
      const sent = statuses.filter((r) => r.status === 'sent').length;
      const failed = statuses.filter((r) => r.status === 'failed' || r.status === 'skipped').length;

      return apiSuccess({ success: true, action, affected: retryIds.length, sent, failed, dispatched });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
