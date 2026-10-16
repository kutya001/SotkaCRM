import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { resolveAppBaseUrl } from '@/lib/telegram/bot';
import { formatMonth } from '@/lib/utils/format';
import { loadMaintenanceAssignments, loadParticipants, setConnectionConfirmation } from '@/lib/services/connections';

/**
 * Telegram по подключениям (044):
 *  - запрос на подтверждение администраторам с полной информацией, списком участников
 *    и одноразовой ссылкой подтверждения;
 *  - подтверждение по ссылке (токен хранится хешем, действует 7 дней, одноразовый);
 *  - сводка начисленного сопровождения одним сообщением на сотрудника.
 */

const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function tokenSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'sotka';
}

export function hashConfirmToken(token: string): string {
  return createHash('sha256').update(`connection-confirm:${token}:${tokenSecret()}`).digest('hex');
}

function generateConfirmToken(): string {
  return randomBytes(24).toString('hex');
}

const fmtMoney = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU');

/** Очередь Telegram через БД-функцию (учитывает привязку чата и настройки сотрудника) */
async function enqueue(userId: string, kind: string, title: string, body: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await (admin.rpc as any)('telegram_enqueue', { p_user_id: userId, p_kind: kind, p_title: title, p_body: body });
  if (error) console.warn('[telegram] Не удалось поставить сообщение в очередь:', error.message);
}

/** Администраторы, подтверждающие подключения: полный доступ роли или право connections.confirm, с привязанным Telegram */
async function confirmingAdmins(): Promise<{ user_id: string; full_name: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('users')
    .select('user_id, full_name, role, is_active, telegram_chat_id, roles:role_id(is_admin, role_permissions(permission))')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null);
  return (data || [])
    .filter((u: any) => {
      const role = Array.isArray(u.roles) ? u.roles[0] : u.roles;
      if (role?.is_admin) return true;
      if (role?.role_permissions?.some((p: { permission: string }) => p.permission === 'connections.confirm')) return true;
      return !role && u.role === 'admin';
    })
    .map((u: any) => ({ user_id: u.user_id, full_name: u.full_name }));
}

/** Месяц сопровождения по номеру от старта сопровождения */
function maintenanceMonth(start: string | null | undefined, index: number): string | null {
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return null;
  const [y, m] = start.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + (index - 1), 1)).toISOString().substring(0, 7);
}

export interface PendingNotifyOptions {
  connectionId: string;
  /** Origin запроса для ссылки подтверждения (NEXT_PUBLIC_APP_URL имеет приоритет) */
  appOrigin?: string | null;
}

/**
 * Запрос на подтверждение подключения администраторам: продавец, тариф, бонус и доли,
 * участники, сопровождение по месяцам, кто создал, одноразовая ссылка подтверждения.
 */
export async function notifyConnectionPendingToAdmins(options: PendingNotifyOptions): Promise<{ notified: number }> {
  const admin = createAdminClient();
  const { connectionId, appOrigin } = options;

  const { data: conn } = await admin
    .from('connections')
    .select(
      'connection_id, seller_phone, seller_name, store, manager_id, assigned_by, plan_id, plan_price, connection_fee, connection_fee_amount, connection_fee_percent, maintenance_fee_monthly, maintenance_months_total, maintenance_months_limit, maintenance_month_start, accrual_month, confirmation_status'
    )
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (!conn || conn.confirmation_status !== 'pending') return { notified: 0 };

  const [participantsMap, assignmentsMap, admins, planRes, creatorRes, sellerRes] = await Promise.all([
    loadParticipants([connectionId]),
    loadMaintenanceAssignments([connectionId]),
    confirmingAdmins(),
    conn.plan_id ? admin.from('plans').select('plan_name').eq('plan_id', conn.plan_id).maybeSingle() : Promise.resolve({ data: null }),
    conn.assigned_by ? admin.from('users').select('full_name').eq('user_id', conn.assigned_by).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('sellers').select('store, seller_name').eq('seller_phone', conn.seller_phone).maybeSingle(),
  ]);
  if (admins.length === 0) return { notified: 0 };

  const participants = participantsMap.get(connectionId) || [];
  const n = Math.max(1, participants.length);
  const fee =
    Number(conn.connection_fee) ||
    Number(conn.connection_fee_amount) ||
    Math.round(((Number(conn.plan_price) || 0) * (Number(conn.connection_fee_percent) || 30)) / 100);
  const monthsTotal = Math.max(1, Number(conn.maintenance_months_total || conn.maintenance_months_limit || 2));
  const assignments = assignmentsMap.get(connectionId) || [];
  const participantNames = participants.map((p, i) => `${i + 1}. ${p?.full_name || 'Сотрудник'}${i === 0 ? ' (основной)' : ''}`);

  const maintenanceLines: string[] = [];
  for (let i = 1; i <= monthsTotal; i++) {
    const rows = assignments.filter((a) => a.month_index === i);
    const names = rows.length > 0 ? rows.map((r) => r.user?.full_name || 'Сотрудник') : participants.map((p) => p?.full_name || 'Сотрудник');
    const month = maintenanceMonth(conn.maintenance_month_start, i);
    maintenanceLines.push(`${i}-й мес.${month ? ` (${formatMonth(month)})` : ''}: ${names.join(', ') || '—'}`);
  }

  const baseUrl = resolveAppBaseUrl(appOrigin);
  const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();
  let notified = 0;

  for (const a of admins) {
    let link: string | null = null;
    if (baseUrl) {
      const token = generateConfirmToken();
      const { error } = await admin.from('telegram_connection_confirmations').insert({
        connection_id: connectionId,
        admin_user_id: a.user_id,
        token_hash: hashConfirmToken(token),
        expires_at: expiresAt,
      });
      if (!error) link = `${baseUrl}/api/telegram/confirm/${token}`;
    }

    const body =
      `Продавец: ${conn.seller_name || sellerRes?.data?.seller_name || '—'}` +
      `\nТелефон: +${conn.seller_phone}` +
      `\nМагазин: ${conn.store || sellerRes?.data?.store || '—'}` +
      (planRes?.data?.plan_name ? `\nТариф: ${planRes.data.plan_name}${Number(conn.plan_price) > 0 ? ` (${fmtMoney(conn.plan_price)} сом)` : ''}` : '') +
      `\nБонус за подключение: ${fmtMoney(fee)} сом${n > 1 ? ` — по 1/${n} каждому участнику` : ''}` +
      `\nМесяц начисления: ${conn.accrual_month || '—'}` +
      `\n\nУчастники (${participants.length}):\n${participantNames.join('\n') || '—'}` +
      `\n\nСопровождение (${fmtMoney(conn.maintenance_fee_monthly)} сом/мес., делится между сопровождающими):\n${maintenanceLines.join('\n')}` +
      `\n\nСоздал: ${creatorRes?.data?.full_name || '—'}` +
      (link
        ? `\n\nПодтвердить подключение (одноразовая ссылка, действует 7 дней):\n${link}\n\nОтклонить с причиной можно в CRM, модуль «Подключения».`
        : `\n\nПодтвердить или отклонить можно в CRM, модуль «Подключения».`);

    await enqueue(a.user_id, 'connections', 'Запрос на подтверждение подключения', body);
    notified++;
  }

  scheduleTelegramDispatch();
  return { notified };
}

export interface ConfirmTokenInfo {
  id: string;
  connection_id: string;
  admin_user_id: string;
  admin_name: string;
  expires_at: string;
  used_at: string | null;
  connection: {
    seller_name: string;
    seller_phone: string;
    store: string;
    confirmation_status: string;
    fee: number;
    participants: string[];
  } | null;
}

/** Поиск одноразовой ссылки (без использования) */
export async function findConfirmToken(token: string): Promise<ConfirmTokenInfo | null> {
  if (!token || token.length < 16) return null;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('telegram_connection_confirmations')
    .select('id, connection_id, admin_user_id, expires_at, used_at')
    .eq('token_hash', hashConfirmToken(token))
    .maybeSingle();
  if (!row) return null;

  const [{ data: adminUser }, { data: conn }, participantsMap] = await Promise.all([
    admin.from('users').select('full_name').eq('user_id', row.admin_user_id).maybeSingle(),
    admin
      .from('connections')
      .select('seller_name, seller_phone, store, confirmation_status, connection_fee, connection_fee_amount, plan_price, connection_fee_percent')
      .eq('connection_id', row.connection_id)
      .maybeSingle(),
    loadParticipants([row.connection_id]),
  ]);

  return {
    id: row.id,
    connection_id: row.connection_id,
    admin_user_id: row.admin_user_id,
    admin_name: adminUser?.full_name || 'Администратор',
    expires_at: row.expires_at,
    used_at: row.used_at,
    connection: conn
      ? {
          seller_name: conn.seller_name,
          seller_phone: conn.seller_phone,
          store: conn.store,
          confirmation_status: conn.confirmation_status,
          fee:
            Number(conn.connection_fee) ||
            Number(conn.connection_fee_amount) ||
            Math.round(((Number(conn.plan_price) || 0) * (Number(conn.connection_fee_percent) || 30)) / 100),
          participants: (participantsMap.get(row.connection_id) || []).map((p) => p?.full_name || 'Сотрудник'),
        }
      : null,
  };
}

/** Подтверждение подключения по одноразовой ссылке: действует от имени администратора из ссылки */
export async function confirmConnectionByToken(
  token: string
): Promise<{ ok: true; info: ConfirmTokenInfo } | { ok: false; reason: string; info: ConfirmTokenInfo | null }> {
  const info = await findConfirmToken(token);
  if (!info) return { ok: false, reason: 'Ссылка не найдена или недействительна', info: null };
  if (info.used_at) return { ok: false, reason: 'Ссылка уже использована', info };
  if (new Date(info.expires_at).getTime() < Date.now()) return { ok: false, reason: 'Срок действия ссылки истек', info };
  if (!info.connection) return { ok: false, reason: 'Подключение не найдено (возможно, удалено)', info };
  if (info.connection.confirmation_status !== 'pending') {
    return {
      ok: false,
      reason: info.connection.confirmation_status === 'confirmed' ? 'Подключение уже подтверждено' : 'Подключение уже отклонено',
      info,
    };
  }

  const res = await setConnectionConfirmation({ connectionId: info.connection_id, action: 'confirm', actor: { user_id: info.admin_user_id } });
  if (!res.success) return { ok: false, reason: res.error, info };

  const admin = createAdminClient();
  // Все ссылки по этому подключению погашаются: подтверждение одноразовое
  await admin
    .from('telegram_connection_confirmations')
    .update({ used_at: new Date().toISOString() })
    .eq('connection_id', info.connection_id)
    .is('used_at', null);

  return { ok: true, info: { ...info, used_at: new Date().toISOString(), connection: { ...info.connection, confirmation_status: 'confirmed' } } };
}

/** Допуск на расхождение часов сервера приложения и БД при отборе проводок запуска */
const ACCRUAL_CLOCK_SKEW_MS = 2000;

export interface MaintenanceNotifyOptions {
  /** Момент запуска начисления (проводки, созданные с этого момента) */
  sinceIso: string;
  /** Подключения запуска (выборочное начисление): сводка только по ним, параллельные запуски не смешиваются */
  connectionIds?: string[];
}

/**
 * Сводка начисленного сопровождения: одно сообщение на сотрудника и расчетный месяц
 * со строками «продавец — сумма» по проводкам сопровождения этого запуска начисления.
 */
export async function notifyMaintenanceAccruals(options: MaintenanceNotifyOptions): Promise<{ notified: number }> {
  const admin = createAdminClient();
  const since = new Date(new Date(options.sinceIso).getTime() - ACCRUAL_CLOCK_SKEW_MS).toISOString();
  let query = admin
    .from('employee_payouts')
    .select('user_id, employee_id, amount, settlement_month, accrual_month, seller_phone, connection_id')
    .eq('operation_type', 'accrual_maintenance')
    .eq('operation_sign', '+')
    .gte('created_at', since);
  if (options.connectionIds) {
    if (options.connectionIds.length === 0) return { notified: 0 };
    query = query.in('connection_id', options.connectionIds);
  }
  const { data: rows } = await query;
  const payouts = rows || [];
  if (payouts.length === 0) return { notified: 0 };

  const phones = Array.from(new Set(payouts.map((p) => p.seller_phone).filter((v): v is string => Boolean(v))));
  const { data: sellers } = phones.length > 0 ? await admin.from('sellers').select('seller_phone, seller_name, store').in('seller_phone', phones) : { data: [] };
  const sellerMap = new Map((sellers || []).map((s) => [s.seller_phone, s]));

  // Группировка по сотруднику и расчетному месяцу: начисления за разные месяцы — отдельными сообщениями
  const byUserMonth = new Map<string, { userId: string; month: string; lines: string[]; total: number }>();
  for (const p of payouts) {
    const userId = p.employee_id || p.user_id;
    if (!userId) continue;
    const seller = p.seller_phone ? sellerMap.get(p.seller_phone) : null;
    const name = seller?.seller_name || seller?.store || (p.seller_phone ? `+${p.seller_phone}` : 'продавец');
    const label = seller?.store && seller.store !== name ? `${name} (${seller.store})` : name;
    const month = p.settlement_month || p.accrual_month || '';
    const key = `${userId}:${month}`;
    const entry = byUserMonth.get(key) || { userId, month, lines: [], total: 0 };
    entry.lines.push(`${label} — ${fmtMoney(p.amount)} сом`);
    entry.total += Number(p.amount) || 0;
    byUserMonth.set(key, entry);
  }

  let notified = 0;
  for (const entry of byUserMonth.values()) {
    const monthLabel = entry.month ? formatMonth(entry.month) : '';
    await enqueue(
      entry.userId,
      'payroll',
      `Сопровождение${monthLabel ? ` за ${monthLabel}` : ''}: +${fmtMoney(entry.total)} сом`,
      entry.lines.join('\n')
    );
    notified++;
  }
  if (notified > 0) scheduleTelegramDispatch();
  return { notified };
}
