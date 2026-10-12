import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { isTelegramConfigured } from '@/lib/telegram/bot';
import {
  countTelegramLinkedByRole,
  dispatchTelegramOutbox,
  enqueueTelegramBroadcast,
} from '@/lib/telegram/outbox';
import type { UserRole } from '@/types/database.types';

export const maxDuration = 60;

const ROLES: UserRole[] = ['admin', 'supervisor', 'consultant', 'smm'];

/** Сколько сотрудников подключили Telegram (по ролям) */
export async function GET() {
  try {
    await requireAdmin();
    const byRole = await countTelegramLinkedByRole();
    const total = Object.values(byRole).reduce((sum, n) => sum + n, 0);
    return apiSuccess({ configured: isTelegramConfigured(), total, by_role: byRole });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Рассылка администратора всем подключенным сотрудникам или выбранным ролям */
export async function POST(req: NextRequest) {
  try {
    const { profile } = await requireAdmin();

    if (!isTelegramConfigured()) {
      return apiError('Telegram-бот не настроен: задайте TELEGRAM_BOT_TOKEN', 'TELEGRAM_NOT_CONFIGURED', 503);
    }

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || '').trim();
    if (message.length < 2) {
      return apiError('Введите текст сообщения', 'VALIDATION_ERROR', 422);
    }
    if (message.length > 3500) {
      return apiError('Сообщение слишком длинное (до 3500 символов)', 'VALIDATION_ERROR', 422);
    }

    const roles = Array.isArray(body?.roles)
      ? (body.roles as string[]).filter((r): r is UserRole => ROLES.includes(r as UserRole))
      : undefined;
    const title = String(body?.title || '').trim() || `Сообщение от ${profile.full_name}`;

    const { queued } = await enqueueTelegramBroadcast({ title, body: message, roles });
    if (queued === 0) {
      return apiSuccess({ queued: 0, sent: 0, failed: 0, message: 'Нет сотрудников с подключенным Telegram' });
    }

    // Рассылка отправляется сразу, чтобы администратор увидел результат
    const result = await dispatchTelegramOutbox(Math.max(queued, 50));
    return apiSuccess({
      queued,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      message: `Отправлено: ${result.sent} из ${queued}`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
