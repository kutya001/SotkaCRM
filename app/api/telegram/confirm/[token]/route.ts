import { NextRequest, NextResponse } from 'next/server';
import { confirmConnectionByToken, findConfirmToken, type ConfirmTokenInfo } from '@/lib/services/connection-notifications';
import { escapeTelegramHtml as esc } from '@/lib/telegram/bot';
import { formatPhoneDisplay } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

/**
 * Подтверждение подключения по одноразовой ссылке из Telegram (044).
 * GET — страница с данными подключения и кнопкой (переход по ссылке ничего не меняет:
 * предпросмотр ссылок Telegram не должен подтверждать подключение); POST — подтверждение.
 * Доступ без входа в CRM: право дает сам токен (хеш в БД, 7 дней, одноразовый).
 */

function page(title: string, inner: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — SotkaCRM</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1115;color:#e4e4e7;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .card{background:#18181b;border:1px solid #27272a;border-radius:20px;padding:24px;max-width:460px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 6px}
  p{margin:6px 0;font-size:14px;color:#a1a1aa;line-height:1.5}
  .kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:14px 0;font-size:14px}
  .kv b{color:#e4e4e7;font-weight:600}
  .ok{color:#34d399}.err{color:#fb7185}.warn{color:#fbbf24}
  button{width:100%;margin-top:12px;height:46px;border:0;border-radius:14px;background:#10b981;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  button:hover{background:#059669}
  .muted{font-size:12px;color:#71717a;margin-top:12px}
</style></head><body><div class="card">${inner}</div></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function summary(info: ConfirmTokenInfo): string {
  const c = info.connection;
  if (!c) return '<p class="err">Подключение не найдено (возможно, удалено).</p>';
  return `<div class="kv">
    <span>Продавец</span><b>${esc(c.seller_name || '—')}</b>
    <span>Телефон</span><b>${esc(formatPhoneDisplay(c.seller_phone))}</b>
    <span>Магазин</span><b>${esc(c.store || '—')}</b>
    <span>Бонус</span><b>${esc(Math.round(c.fee).toLocaleString('ru-RU'))} сом${c.participants.length > 1 ? ` — по 1/${c.participants.length} каждому` : ''}</b>
    <span>Участники</span><b>${esc(c.participants.join(', ') || '—')}</b>
    <span>Администратор</span><b>${esc(info.admin_name)}</b>
  </div>`;
}

function invalidReason(info: ConfirmTokenInfo | null): string | null {
  if (!info) return 'Ссылка не найдена или недействительна.';
  if (info.used_at) return 'Ссылка уже использована.';
  if (new Date(info.expires_at).getTime() < Date.now()) return 'Срок действия ссылки истек (7 дней).';
  if (!info.connection) return 'Подключение не найдено (возможно, удалено).';
  if (info.connection.confirmation_status === 'confirmed') return 'Подключение уже подтверждено.';
  if (info.connection.confirmation_status === 'rejected') return 'Подключение уже отклонено.';
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await findConfirmToken(token);
  const reason = invalidReason(info);
  if (reason) {
    return page(
      'Ссылка недействительна',
      `<h1>Подтверждение подключения</h1><p class="warn">${esc(reason)}</p>${info ? summary(info) : ''}<p class="muted">Подтвердить или отклонить подключение можно в CRM, модуль «Подключения».</p>`,
      info ? 200 : 404
    );
  }
  return page(
    'Подтверждение подключения',
    `<h1>Подтвердить подключение?</h1><p>После подтверждения участникам будет начислен бонус за подключение и отправлено уведомление.</p>${summary(info!)}
     <form method="post"><button type="submit">Подтвердить подключение</button></form>
     <p class="muted">Ссылка одноразовая. Отклонить с указанием причины можно в CRM.</p>`
  );
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await confirmConnectionByToken(token);
  if (!res.ok) {
    return page(
      'Подтверждение не выполнено',
      `<h1>Подтверждение не выполнено</h1><p class="err">${esc(res.reason)}</p>${res.info ? summary(res.info) : ''}<p class="muted">Проверьте подключение в CRM, модуль «Подключения».</p>`,
      res.info ? 409 : 404
    );
  }
  return page(
    'Подключение подтверждено',
    `<h1 class="ok">Подключение подтверждено</h1><p>Бонус за подключение начислен участникам, им отправлено уведомление в Telegram.</p>${summary(res.info)}`
  );
}
