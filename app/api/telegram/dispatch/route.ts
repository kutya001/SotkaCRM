import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { dispatchTelegramOutbox } from '@/lib/telegram/outbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Принудительная отправка очереди Telegram: Vercel Cron (Bearer CRON_SECRET)
 * или администратор. Обычно очередь отправляется сразу после событий,
 * этот маршрут — страховка на случай сбоев.
 */
async function handle(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret && authHeader && (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret));

  if (!isCron) {
    try {
      await requireAdmin();
    } catch {
      return NextResponse.json({ error: 'Требуется авторизация администратора' }, { status: 401 });
    }
  }

  const result = await dispatchTelegramOutbox(100);
  return NextResponse.json({ success: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
