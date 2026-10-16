import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import type { AuthContext } from '@/lib/auth/check-role';
import type { ConnectionConfirmationStatus } from '@/types/database.types';

/**
 * Подключения продавцов к консультантам: назначение консультанта и подтверждение администратором.
 *
 * Записи в sellers/connections разрешены RLS только администратору, поэтому сервис пишет
 * сервисным клиентом после проверки прав вызывающим маршрутом.
 *
 * Правило 037: подключение консультанта («Взять себе», привязка лида) создается со статусом
 * pending; начисление за подключение (триггер 035) и уведомления (036) срабатывают при
 * подтверждении администратором.
 */

export type ServiceError = { success: false; error: string; code: string; status: number };
export type ServiceResult<T> = ({ success: true } & T) | ServiceError;

const fail = (error: string, code: string, status = 400): ServiceError => ({ success: false, error, code, status });

/** Инициатор операции: достаточно user_id (права проверяет вызывающий маршрут через requirePermission) */
type Actor = Pick<AuthContext['profile'], 'user_id'> & Partial<Pick<AuthContext['profile'], 'role'>>;

/**
 * Подключения, где сотрудник участвует помимо основного (connection_participants, 043)
 * или назначен на сопровождение хотя бы одного месяца (042).
 */
export async function maintenanceConnectionIdsFor(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: maint }, { data: parts }] = await Promise.all([
    admin.from('connection_maintenance_assignments').select('connection_id').eq('user_id', userId),
    admin.from('connection_participants').select('connection_id').eq('user_id', userId),
  ]);
  return Array.from(new Set([...(maint || []), ...(parts || [])].map((r) => r.connection_id)));
}

/** Все участники подключения: основной (manager_id) первым, далее по порядку добавления (043) */
export async function loadParticipants(
  connectionIds: string[]
): Promise<Map<string, MaintenanceAssignmentView['user'][]>> {
  const result = new Map<string, MaintenanceAssignmentView['user'][]>();
  if (connectionIds.length === 0) return result;
  const admin = createAdminClient();
  const [{ data: conns }, { data: rows }] = await Promise.all([
    admin.from('connections').select('connection_id, manager_id').in('connection_id', connectionIds),
    admin
      .from('connection_participants')
      .select('connection_id, user_id, added_at')
      .in('connection_id', connectionIds)
      .order('added_at', { ascending: true }),
  ]);
  const idsByConn = new Map<string, string[]>();
  for (const c of conns || []) idsByConn.set(c.connection_id, c.manager_id ? [c.manager_id] : []);
  for (const r of rows || []) {
    const arr = idsByConn.get(r.connection_id) || [];
    if (!arr.includes(r.user_id)) arr.push(r.user_id);
    idsByConn.set(r.connection_id, arr);
  }
  const userIds = Array.from(new Set(Array.from(idsByConn.values()).flat()));
  const users = new Map<string, MaintenanceAssignmentView['user']>();
  if (userIds.length > 0) {
    const { data: us } = await admin.from('users').select('user_id, full_name, role, login, color').in('user_id', userIds);
    (us || []).forEach((u) => users.set(u.user_id, { ...u, color: u.color ?? null }));
  }
  for (const [cid, ids] of idsByConn) {
    result.set(
      cid,
      ids.map((id) => users.get(id) || { user_id: id, full_name: 'Сотрудник', role: '', login: '', color: null })
    );
  }
  return result;
}

/** Идентификаторы участников подключения (основной первым) */
export async function participantIdsOf(connectionId: string): Promise<string[]> {
  const map = await loadParticipants([connectionId]);
  return (map.get(connectionId) || []).map((u) => u!.user_id);
}

/**
 * Область видимости подключения: без «connections.view_all» — свои (подключил, manager_id = я)
 * и те, где я назначен на сопровождение (список передается вызывающим кодом).
 */
export function isConnectionInScope(
  ctx: { canViewAll: (module: string) => boolean; profile: { user_id: string } },
  conn: { connection_id?: string; manager_id: string | null },
  maintenanceConnectionIds?: Iterable<string>
): boolean {
  if (ctx.canViewAll('connections') || conn.manager_id === ctx.profile.user_id) return true;
  if (!conn.connection_id || !maintenanceConnectionIds) return false;
  for (const id of maintenanceConnectionIds) if (id === conn.connection_id) return true;
  return false;
}

/** PostgREST-фильтр .or() области видимости сотрудника без «connections.view_all» */
export async function connectionOwnScopeFilter(userId: string): Promise<string> {
  const ids = await maintenanceConnectionIdsFor(userId);
  return ids.length > 0 ? `manager_id.eq.${userId},connection_id.in.(${ids.join(',')})` : `manager_id.eq.${userId}`;
}

export interface MaintenanceAssignmentView {
  month_index: number;
  user_id: string;
  status: 'planned' | 'accrued';
  accrued_month: string | null;
  assigned_at: string;
  user: { user_id: string; full_name: string; role: string; login: string; color: string | null } | null;
}

/** Назначения сопровождения по месяцам для набора подключений (с данными сотрудников) */
export async function loadMaintenanceAssignments(
  connectionIds: string[]
): Promise<Map<string, MaintenanceAssignmentView[]>> {
  const result = new Map<string, MaintenanceAssignmentView[]>();
  if (connectionIds.length === 0) return result;
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('connection_maintenance_assignments')
    .select('connection_id, month_index, user_id, status, accrued_month, assigned_at')
    .in('connection_id', connectionIds)
    .order('month_index', { ascending: true });
  const list = rows || [];
  const userIds = Array.from(new Set(list.map((r) => r.user_id)));
  const users = new Map<string, MaintenanceAssignmentView['user']>();
  if (userIds.length > 0) {
    const { data: us } = await admin.from('users').select('user_id, full_name, role, login, color').in('user_id', userIds);
    (us || []).forEach((u) => users.set(u.user_id, { ...u, color: u.color ?? null }));
  }
  for (const r of list) {
    const arr = result.get(r.connection_id) || [];
    arr.push({
      month_index: r.month_index,
      user_id: r.user_id,
      status: r.status,
      accrued_month: r.accrued_month,
      assigned_at: r.assigned_at,
      user: users.get(r.user_id) || null,
    });
    result.set(r.connection_id, arr);
  }
  return result;
}

export interface MaintenanceAssignmentInput {
  month_index: number;
  /** Пустой список — сопровождают все участники подключения (назначения месяца снимаются) */
  user_ids: string[];
}

interface StaffParams {
  connectionId: string;
  /** Полный состав участников: первый — основной (подключивший, manager_id). Назначение подтверждает подключение */
  participants?: string[];
  /** Сопровождающие по месяцам */
  maintenance?: MaintenanceAssignmentInput[];
  actor: Actor;
  /**
   * admin — право connections.edit (любые изменения);
   * participant — участник подключения: может только исключать (себя или коллег) из участников и из месяцев сопровождения
   */
  mode: 'admin' | 'participant';
  /** В режиме admin назначение участников подтверждает подключение (по умолчанию); false — не трогать статус */
  allowConfirm?: boolean;
  /**
   * Заполнить сопровождение по месяцам участниками (явные строки вместо «по умолчанию»):
   * месяцы без строк или со строками, равными прежнему составу, получают новый состав
   */
  materializeMaintenance?: boolean;
}

export interface StaffResult {
  connectionId: string;
  participantsChanged: boolean;
  managerChanged: boolean;
  confirmed: boolean;
  maintenanceUpdated: number;
  skipped: string[];
}

const uniq = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

/**
 * Сотрудники подключения (042/043): участники (бонус за подключение делится поровну; смена состава
 * пересчитывает неоплаченные доли триггером БД) и сопровождающие по месяцам (доли при начислении).
 * Назначение участников администратором подтверждает подключение. Сопровождение подтверждается
 * только при начислении за месяц; уже начисленные месяцы не меняются.
 */
export async function assignConnectionStaff(params: StaffParams): Promise<ServiceResult<StaffResult>> {
  const { connectionId, maintenance = [], actor, mode, allowConfirm = true, materializeMaintenance = true } = params;
  const admin = createAdminClient();

  const { data: conn, error: connErr } = await admin
    .from('connections')
    .select('connection_id, seller_phone, manager_id, confirmation_status, maintenance_months_total, maintenance_months_limit')
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (connErr) return fail(connErr.message, 'DB_ERROR', 500);
  if (!conn) return fail('Подключение не найдено', 'NOT_FOUND', 404);

  const currentParticipants = await participantIdsOf(connectionId);
  if (mode === 'participant' && !currentParticipants.includes(actor.user_id)) {
    return fail('Изменять состав могут только участники этого подключения', 'FORBIDDEN', 403);
  }

  const requested = params.participants ? uniq(params.participants) : undefined;
  if (requested && requested.length === 0) return fail('В подключении должен остаться хотя бы один участник', 'VALIDATION_ERROR', 422);
  if (requested && requested.length > 3) return fail('В подключении может быть не более трех участников', 'VALIDATION_ERROR', 422);

  // Участник может только исключать: новый состав — подмножество текущего
  if (mode === 'participant' && requested) {
    const added = requested.filter((id) => !currentParticipants.includes(id));
    if (added.length > 0) return fail('Участник может только исключать из подключения, добавляет администратор', 'FORBIDDEN', 403);
  }

  const userIds = uniq([...(requested || []), ...maintenance.flatMap((m) => m.user_ids || [])]);
  if (userIds.length > 0) {
    const { data: users } = await admin.from('users').select('user_id, is_active').in('user_id', userIds);
    const active = new Set((users || []).filter((u) => u.is_active).map((u) => u.user_id));
    if (userIds.some((id) => !active.has(id))) return fail('Сотрудник не найден или отключен', 'USER_NOT_FOUND', 404);
  }

  const nowIso = new Date().toISOString();
  const skipped: string[] = [];
  let participantsChanged = false;
  let managerChanged = false;
  let confirmed = false;

  // 1. Состав участников: основной (manager_id) + остальные (connection_participants).
  //    Подтверждение выполняется после записи состава (1c): триггеры начисления и Telegram
  //    должны видеть всех участников, иначе основной получит сообщение с полной суммой бонуса.
  if (requested) {
    const nextManager = requested[0];
    const needsManager = nextManager !== conn.manager_id;
    const needsConfirm = mode === 'admin' && allowConfirm && conn.confirmation_status !== 'confirmed';
    // 1a. Смена основного
    if (needsManager) {
      const { error } = await admin
        .from('connections')
        .update({ manager_id: nextManager, assigned_by: actor.user_id, assigned_at: nowIso })
        .eq('connection_id', connectionId);
      if (error) return fail(error.message, 'DB_ERROR', 500);
      managerChanged = true;
    }
    if (needsManager || needsConfirm) {
      // Консультант в карточке продавца — основной участник
      await admin.from('sellers').update({ manager_id: nextManager }).eq('seller_phone', conn.seller_phone);
    }

    // 1b. Остальные участники
    const extras = requested.slice(1);
    const { data: existingRows } = await admin
      .from('connection_participants')
      .select('user_id')
      .eq('connection_id', connectionId);
    const existing = new Set((existingRows || []).map((r) => r.user_id));
    const toRemove = Array.from(existing).filter((id) => !extras.includes(id));
    const toAdd = extras.filter((id) => !existing.has(id));
    if (toRemove.length > 0) {
      const { error } = await admin
        .from('connection_participants')
        .delete()
        .eq('connection_id', connectionId)
        .in('user_id', toRemove);
      if (error) return fail(error.message, 'DB_ERROR', 500);
      participantsChanged = true;
    }
    if (toAdd.length > 0) {
      const { error } = await admin.from('connection_participants').insert(
        toAdd.map((user_id) => ({ connection_id: connectionId, user_id, added_by: actor.user_id, added_at: nowIso }))
      );
      if (error) return fail(error.message, 'DB_ERROR', 500);
      participantsChanged = true;
    }
    if (needsManager) participantsChanged = true;

    // 1c. Подтверждение — после состава участников
    if (needsConfirm) {
      const restart = conn.confirmation_status === 'rejected';
      const now = new Date();
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().substring(0, 7);
      const { error } = await admin
        .from('connections')
        .update({
          confirmation_status: 'confirmed',
          confirmed_by: actor.user_id,
          confirmed_at: nowIso,
          rejection_reason: null,
          ...(restart
            ? { status: 'подключен', client_status: 'новый', accrual_month: nowIso.substring(0, 7), maintenance_month_start: nextMonth }
            : {}),
        })
        .eq('connection_id', connectionId);
      if (error) return fail(error.message, 'DB_ERROR', 500);
      confirmed = true;
    }
  }

  // Назначения сопровождения читаются один раз: между блоками 2a и 2b они не меняются
  type AssignmentRow = { month_index: number; user_id: string; status: string };
  let assignmentRows: AssignmentRow[] | null = null;
  const loadAssignmentsByMonth = async (): Promise<Map<number, AssignmentRow[]>> => {
    if (!assignmentRows) {
      const { data } = await admin
        .from('connection_maintenance_assignments')
        .select('month_index, user_id, status')
        .eq('connection_id', connectionId);
      assignmentRows = (data || []) as AssignmentRow[];
    }
    const byMonth = new Map<number, AssignmentRow[]>();
    for (const r of assignmentRows) {
      const arr = byMonth.get(r.month_index) || [];
      arr.push(r);
      byMonth.set(r.month_index, arr);
    }
    return byMonth;
  };

  // 2. Сопровождение по месяцам: planned-назначения заменяются набором; accrued месяцы не трогаем.
  // 2a. При смене состава участников месяцы «по умолчанию» (без строк или со строками прежнего состава)
  //     явно заполняются новым составом (044); состав, заданный администратором вручную, сохраняется.
  let maintenanceUpdated = 0;
  const maintenanceInput: MaintenanceAssignmentInput[] = [...maintenance];
  if (requested && materializeMaintenance && (participantsChanged || maintenanceInput.length === 0)) {
    const monthsTotal = Math.max(1, Number(conn.maintenance_months_total || conn.maintenance_months_limit || 2));
    const explicit = new Set(maintenanceInput.map((m) => Number(m.month_index)));
    const byMonth = await loadAssignmentsByMonth();
    for (let i = 1; i <= monthsTotal; i++) {
      if (explicit.has(i)) continue;
      const current = byMonth.get(i) || [];
      if (current.some((r) => r.status === 'accrued')) continue;
      const ids = current.map((r) => r.user_id);
      const wasDefault =
        ids.length === 0 || (ids.length === currentParticipants.length && ids.every((id) => currentParticipants.includes(id)));
      if (!wasDefault) continue;
      const same = ids.length === requested.length && requested.every((id) => ids.includes(id));
      if (same) continue;
      maintenanceInput.push({ month_index: i, user_ids: requested });
    }
  }
  // 2b. Применение наборов по месяцам
  if (maintenanceInput.length > 0) {
    const effectiveParticipants = requested || currentParticipants;
    const byMonth = await loadAssignmentsByMonth();

    for (const item of maintenanceInput) {
      const idx = Number(item.month_index);
      if (!Number.isInteger(idx) || idx < 1 || idx > 24) {
        skipped.push(`месяц ${item.month_index}: неверный номер месяца`);
        continue;
      }
      const current = byMonth.get(idx) || [];
      if (current.some((r) => r.status === 'accrued')) {
        skipped.push(`месяц ${idx}: уже начислено, состав не меняется`);
        continue;
      }
      const next = uniq(item.user_ids || []);
      if (next.length > 3) {
        skipped.push(`месяц ${idx}: не более трех сопровождающих`);
        continue;
      }
      const currentIds = current.map((r) => r.user_id);
      const currentEffective = currentIds.length > 0 ? currentIds : effectiveParticipants;
      if (mode === 'participant') {
        if (next.length === 0) {
          skipped.push(`месяц ${idx}: участник может только исключать сопровождающих`);
          continue;
        }
        if (next.some((id) => !currentEffective.includes(id))) {
          skipped.push(`месяц ${idx}: участник может только исключать сопровождающих`);
          continue;
        }
      }
      const same = next.length === currentIds.length && next.every((id) => currentIds.includes(id));
      if (same) continue;

      if (currentIds.length > 0) {
        const { error } = await admin
          .from('connection_maintenance_assignments')
          .delete()
          .eq('connection_id', connectionId)
          .eq('month_index', idx)
          .eq('status', 'planned');
        if (error) return fail(error.message, 'DB_ERROR', 500);
      }
      if (next.length > 0) {
        const { error } = await admin.from('connection_maintenance_assignments').insert(
          next.map((user_id) => ({
            connection_id: connectionId,
            month_index: idx,
            user_id,
            assigned_by: actor.user_id,
            assigned_at: nowIso,
            status: 'planned' as const,
          }))
        );
        if (error) return fail(error.message, 'DB_ERROR', 500);
      }
      maintenanceUpdated++;
    }
  }

  scheduleTelegramDispatch();
  return { success: true, connectionId, participantsChanged, managerChanged, confirmed, maintenanceUpdated, skipped };
}

/**
 * Удаление подключения (одиночное и массовое): консультант у продавца снимается, назначения
 * сопровождения, участники и начисления по подключению удаляются из обоих регистров.
 * Область видимости и право connections.delete проверяет вызывающий маршрут.
 */
export async function deleteConnection(connectionId: string): Promise<ServiceResult<{ deletedId: string; sellerPhone: string | null }>> {
  const admin = createAdminClient();
  const { data: conn, error: getErr } = await admin
    .from('connections')
    .select('connection_id, seller_phone, manager_id')
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (getErr) return fail(getErr.message, 'DB_ERROR', 500);
  if (!conn) return fail('Подключение не найдено', 'NOT_FOUND', 404);

  if (conn.seller_phone) {
    const { error: sellerErr } = await admin.from('sellers').update({ manager_id: null }).eq('seller_phone', conn.seller_phone);
    if (sellerErr) console.error('[deleteConnection] Ошибка сброса консультанта продавца:', sellerErr);
  }

  await admin.from('connection_maintenance_assignments').delete().eq('connection_id', connectionId);
  await admin.from('connection_participants').delete().eq('connection_id', connectionId);
  await admin.from('connection_accruals').delete().eq('connection_id', connectionId);
  await admin.from('employee_payouts').delete().eq('connection_id', connectionId).eq('operation_sign', '+');
  try {
    await admin.from('client_maintenance').delete().eq('connection_id', connectionId);
  } catch {}

  const { error: delErr } = await admin.from('connections').delete().eq('connection_id', connectionId);
  if (delErr) return fail(delErr.message, 'DB_ERROR', 500);

  scheduleTelegramDispatch();
  return { success: true, deletedId: connectionId, sellerPhone: conn.seller_phone ?? null };
}

interface CreateSellerConnectionParams {
  sellerPhone: string;
  /** Полный состав участников; создающий сотрудник обязан быть в списке */
  participants: string[];
  maintenance?: MaintenanceAssignmentInput[];
  actor: Actor;
  /** Право подтверждать подключения: подключение создается сразу подтвержденным */
  canConfirm: boolean;
  /** Origin запроса — для одноразовой ссылки подтверждения в Telegram */
  appOrigin?: string | null;
}

/**
 * Подключение продавца сотрудником (быстрое действие в модуле «Продавцы», 043):
 * создающий — обязательный участник и основной (консультант продавца); можно добавить до двух коллег
 * и задать сопровождающих по месяцам (по умолчанию — все участники). Без права подтверждать —
 * подключение ожидает подтверждения администратора.
 */
export async function createSellerConnection(
  params: CreateSellerConnectionParams
): Promise<ServiceResult<{ connectionId: string; confirmationStatus: ConnectionConfirmationStatus; skipped: string[] }>> {
  const { sellerPhone, actor, canConfirm, maintenance = [], appOrigin } = params;
  const participants = uniq(params.participants);
  if (!participants.includes(actor.user_id)) {
    return fail('Вы должны быть участником создаваемого подключения', 'ACTOR_NOT_PARTICIPANT', 422);
  }
  if (participants.length > 3) return fail('В подключении может быть не более трех участников', 'VALIDATION_ERROR', 422);
  // Основной — создающий сотрудник
  const ordered = [actor.user_id, ...participants.filter((id) => id !== actor.user_id)];

  // Подключение создается ожидающим и подтверждается (при праве) уже после записи участников:
  // начисление и уведомления участникам должны видеть полный состав, а не только основного
  const created = await assignSellerToManager({
    sellerPhone,
    managerId: actor.user_id,
    actor,
    confirmation: 'pending',
    expectUnassigned: true,
    requireApproved: true,
    materializeMaintenance: false,
  });
  if (!created.success) return created;
  const connectionId = created.connectionId;
  if (!connectionId) return fail('Подключение не создано', 'DB_ERROR', 500);

  const staff = await assignConnectionStaff({
    connectionId,
    participants: ordered,
    maintenance,
    actor,
    mode: 'admin',
    allowConfirm: canConfirm,
  });
  if (!staff.success) return staff;

  // Ожидает подтверждения: запрос администраторам с составом участников и одноразовой ссылкой (044)
  if (!canConfirm) {
    const { notifyConnectionPendingToAdmins } = await import('@/lib/services/connection-notifications');
    await notifyConnectionPendingToAdmins({ connectionId, appOrigin }).catch((err) =>
      console.warn('[createSellerConnection] Уведомление администраторам не отправлено:', err)
    );
  }

  return {
    success: true,
    connectionId,
    confirmationStatus: staff.confirmed ? 'confirmed' : 'pending',
    skipped: staff.skipped,
  };
}

interface AssignParams {
  sellerPhone: string;
  managerId: string | null;
  actor: Actor;
  /** confirmed — назначение администратором; pending — консультант взял продавца сам */
  confirmation: Extract<ConnectionConfirmationStatus, 'confirmed' | 'pending'>;
  /** Заполнить сопровождение по месяцам консультантом (044); false — состав задаст вызывающий */
  materializeMaintenance?: boolean;
  /** Продавец должен быть без консультанта (защита от гонки двух консультантов) */
  expectUnassigned?: boolean;
  /** Только одобренный модерацией продавец (самоназначение консультанта) */
  requireApproved?: boolean;
}

/** Цена тарифа и ставка консультанта на текущую дату */
async function resolvePlanPriceAndRate(
  admin: ReturnType<typeof createAdminClient>,
  planId: string | null,
  managerId: string
): Promise<{ planPrice: number; connectionPercent: number; maintenancePercent: number }> {
  let planPrice = 2500;
  const today = new Date().toISOString().substring(0, 10);
  const currentMonth = today.substring(0, 7);

  if (planId) {
    const { data: priceData } = await admin.rpc('get_plan_price_on_date', { p_plan_id: planId, p_date: today });
    if (priceData && Number(priceData) > 0) {
      planPrice = Number(priceData);
    } else {
      const { data: planData } = await admin.from('plans').select('price').eq('plan_id', planId).maybeSingle();
      if (planData && Number(planData.price) > 0) planPrice = Number(planData.price);
    }
  }

  let connectionPercent = 30;
  let maintenancePercent = 10;
  const { data: rpcRate } = await admin.rpc('get_employee_rate_on_month', {
    p_user_id: managerId,
    p_month: currentMonth,
  });
  const rateRow = Array.isArray(rpcRate) ? rpcRate[0] : (rpcRate as any);
  if (rateRow && typeof rateRow === 'object') {
    if ('connection_percent' in rateRow) connectionPercent = Number(rateRow.connection_percent) || 30;
    if ('maintenance_percent' in rateRow) maintenancePercent = Number(rateRow.maintenance_percent) || 10;
  }

  return { planPrice, connectionPercent, maintenancePercent };
}

/**
 * Назначение / снятие консультанта продавца с синхронизацией подключения.
 * При managerId = null подключение удаляется (как и прежде — вместе с начислениями по триггеру).
 */
export async function assignSellerToManager(
  params: AssignParams
): Promise<ServiceResult<{ connectionId?: string; confirmationStatus?: ConnectionConfirmationStatus }>> {
  const { sellerPhone, managerId, actor, confirmation, expectUnassigned = false, requireApproved = false, materializeMaintenance = true } = params;
  if (!sellerPhone) return fail('Не указан номер телефона продавца', 'MISSING_PHONE');

  const admin = createAdminClient();

  const { data: seller, error: sellerErr } = await admin
    .from('sellers')
    .select('seller_phone, seller_name, store, plan_id, manager_id, moderation, is_active')
    .eq('seller_phone', sellerPhone)
    .maybeSingle();
  if (sellerErr) return fail(sellerErr.message, 'DB_ERROR', 500);
  if (!seller) return fail('Продавец не найден', 'NOT_FOUND', 404);

  if (requireApproved && seller.moderation !== 'approved') {
    return fail('Взять можно только продавца, одобренного модерацией Sotka', 'SELLER_NOT_APPROVED', 409);
  }

  // 1. Консультант в карточке продавца (при expectUnassigned — только если он еще свободен)
  let updateSeller = admin.from('sellers').update({ manager_id: managerId }).eq('seller_phone', sellerPhone);
  if (expectUnassigned) updateSeller = updateSeller.is('manager_id', null);
  const { data: updatedRows, error: updateErr } = await updateSeller.select('seller_phone');
  if (updateErr) return fail(updateErr.message, 'DB_ERROR', 500);
  if (!updatedRows || updatedRows.length === 0) {
    return fail('У продавца уже есть консультант', 'SELLER_ALREADY_TAKEN', 409);
  }

  // 2. Снятие консультанта: подключение удаляется (начисления чистит триггер)
  if (!managerId) {
    const { error: delErr } = await admin.from('connections').delete().eq('seller_phone', sellerPhone);
    if (delErr) return fail(delErr.message, 'DB_ERROR', 500);
    scheduleTelegramDispatch();
    return { success: true };
  }

  // 3. Тариф и ставка на дату назначения
  const { planPrice, connectionPercent, maintenancePercent } = await resolvePlanPriceAndRate(
    admin,
    seller.plan_id,
    managerId
  );
  const connectionFeeAmount = Math.round(((planPrice * connectionPercent) / 100) * 100) / 100;
  const maintenanceFeeMonthly = Math.round(((planPrice * maintenancePercent) / 100) * 100) / 100;
  const now = new Date();
  const nowIso = now.toISOString();
  const currentMonth = nowIso.substring(0, 7);
  const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const maintenanceMonthStart = nextMonthDate.toISOString().substring(0, 7);

  const confirmationFields = {
    confirmation_status: confirmation,
    confirmed_by: confirmation === 'confirmed' ? actor.user_id : null,
    confirmed_at: confirmation === 'confirmed' ? nowIso : null,
    rejection_reason: null,
  };

  // 4. Подключение продавца одно: существующее обновляется, иначе создается
  const { data: existing } = await admin
    .from('connections')
    .select('connection_id, manager_id, confirmation_status')
    .eq('seller_phone', sellerPhone)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const managerChanged = existing.manager_id !== managerId;
    const restart = existing.confirmation_status === 'rejected' || managerChanged;
    // Новый консультант: прежние участники и запланированное сопровождение прежнего состава снимаются,
    // иначе явные строки сопровождения (044) остались бы за прежним консультантом
    if (managerChanged) {
      const { error: partErr } = await admin.from('connection_participants').delete().eq('connection_id', existing.connection_id);
      if (partErr) return fail(partErr.message, 'DB_ERROR', 500);
      const { error: maintErr } = await admin
        .from('connection_maintenance_assignments')
        .delete()
        .eq('connection_id', existing.connection_id)
        .eq('status', 'planned');
      if (maintErr) return fail(maintErr.message, 'DB_ERROR', 500);
    }
    const { error: connErr } = await admin
      .from('connections')
      .update({
        manager_id: managerId,
        assigned_by: actor.user_id,
        assigned_at: nowIso,
        plan_id: seller.plan_id,
        plan_price: planPrice,
        connection_fee_percent: connectionPercent,
        connection_fee_amount: connectionFeeAmount,
        maintenance_fee_monthly: maintenanceFeeMonthly,
        ...(restart
          ? {
              status: 'подключен',
              client_status: 'новый',
              accrual_month: currentMonth,
              maintenance_month_start: maintenanceMonthStart,
            }
          : {}),
        ...confirmationFields,
      })
      .eq('connection_id', existing.connection_id);
    if (connErr) return fail(connErr.message, 'DB_ERROR', 500);

    // Сопровождение по месяцам заполняется новым консультантом (044)
    if (managerChanged && materializeMaintenance) {
      const staff = await assignConnectionStaff({
        connectionId: existing.connection_id,
        participants: [managerId],
        actor,
        mode: 'admin',
        allowConfirm: false,
      });
      if (!staff.success) return staff;
    }

    scheduleTelegramDispatch();
    return { success: true, connectionId: existing.connection_id, confirmationStatus: confirmation };
  }

  const { data: created, error: insertErr } = await admin
    .from('connections')
    .insert({
      seller_phone: sellerPhone,
      seller_name: seller.seller_name,
      store: seller.store || 'Без названия',
      manager_id: managerId,
      assigned_by: actor.user_id,
      assigned_at: nowIso,
      status: 'подключен',
      plan_id: seller.plan_id,
      plan_price: planPrice,
      connection_fee_percent: connectionPercent,
      connection_fee_amount: connectionFeeAmount,
      connection_fee: connectionFeeAmount,
      maintenance_fee_monthly: maintenanceFeeMonthly,
      accrual_month: currentMonth,
      maintenance_month_start: maintenanceMonthStart,
      client_status: 'новый',
      maintenance_months_limit: 3,
      maintenance_months_total: 2,
      maintenance_months_accrued: 0,
      ...confirmationFields,
    })
    .select('connection_id')
    .single();
  if (insertErr) return fail(insertErr.message, 'DB_ERROR', 500);

  // Сопровождение по месяцам заполняется консультантом сразу (044)
  if (materializeMaintenance) {
    const staff = await assignConnectionStaff({
      connectionId: created.connection_id,
      participants: [managerId],
      actor,
      mode: 'admin',
      allowConfirm: false,
    });
    if (!staff.success) return staff;
  }

  scheduleTelegramDispatch();
  return { success: true, connectionId: created.connection_id, confirmationStatus: confirmation };
}

interface ConfirmationParams {
  connectionId: string;
  action: 'confirm' | 'reject';
  reason?: string | null;
  actor: Actor;
}

/**
 * Подтверждение или отклонение подключения администратором.
 * confirm: только из pending → confirmed (начисление и уведомление — триггеры 035/036).
 * reject: pending → rejected с причиной; консультант у продавца снимается, привязанный лид
 * возвращается в «Назначен» (RPC unlink_lead_and_seller).
 */
export async function setConnectionConfirmation(
  params: ConfirmationParams
): Promise<ServiceResult<{ connectionId: string; confirmationStatus: ConnectionConfirmationStatus; sellerPhone: string }>> {
  const { connectionId, action, actor } = params;
  const reason = (params.reason || '').trim();
  const admin = createAdminClient();

  const { data: conn, error: connErr } = await admin
    .from('connections')
    .select('connection_id, seller_phone, manager_id, confirmation_status')
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (connErr) return fail(connErr.message, 'DB_ERROR', 500);
  if (!conn) return fail('Подключение не найдено', 'NOT_FOUND', 404);

  if (conn.confirmation_status !== 'pending') {
    return fail(
      conn.confirmation_status === 'confirmed'
        ? 'Подключение уже подтверждено'
        : 'Подключение уже отклонено — консультант может взять продавца заново',
      'NOT_PENDING',
      409
    );
  }

  const nowIso = new Date().toISOString();

  if (action === 'confirm') {
    const { error } = await admin
      .from('connections')
      .update({
        confirmation_status: 'confirmed',
        confirmed_by: actor.user_id,
        confirmed_at: nowIso,
        rejection_reason: null,
      })
      .eq('connection_id', connectionId)
      .eq('confirmation_status', 'pending');
    if (error) return fail(error.message, 'DB_ERROR', 500);

    scheduleTelegramDispatch();
    return { success: true, connectionId, confirmationStatus: 'confirmed', sellerPhone: conn.seller_phone };
  }

  if (reason.length < 3) {
    return fail('Укажите причину отклонения (не менее 3 символов)', 'REJECTION_REASON_REQUIRED', 422);
  }

  const { error: rejectErr } = await admin
    .from('connections')
    .update({
      confirmation_status: 'rejected',
      rejection_reason: reason.slice(0, 500),
      confirmed_by: actor.user_id,
      confirmed_at: nowIso,
    })
    .eq('connection_id', connectionId)
    .eq('confirmation_status', 'pending');
  if (rejectErr) return fail(rejectErr.message, 'DB_ERROR', 500);

  // Привязанный лид возвращается в «Назначен», консультант у продавца снимается
  const { data: linkedLead } = await admin
    .from('leads')
    .select('lead_id')
    .eq('seller_phone', conn.seller_phone)
    .maybeSingle();
  if (linkedLead) {
    const { error: unlinkErr } = await (admin.rpc as any)('unlink_lead_and_seller', { p_lead_id: linkedLead.lead_id });
    if (unlinkErr) console.error('[setConnectionConfirmation] unlink_lead_and_seller:', unlinkErr);
  }
  await admin
    .from('sellers')
    .update({ manager_id: null })
    .eq('seller_phone', conn.seller_phone)
    .eq('manager_id', conn.manager_id);

  scheduleTelegramDispatch();
  return { success: true, connectionId, confirmationStatus: 'rejected', sellerPhone: conn.seller_phone };
}
