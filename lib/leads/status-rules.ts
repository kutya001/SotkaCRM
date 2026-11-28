import type { LeadStatus } from '@/types/database.types';
import { hasPermission } from '../auth/permissions.ts';
import { isLeadStatusRollback } from '../auth/permissions-catalog.ts';
import { buildCancelReason } from './cancel-reasons.ts';

/**
 * Единые правила работы с лидами по правам доступа (каталог lib/auth/permissions-catalog).
 * Используются и интерфейсом (какие статусы предлагать), и API (что разрешить), чтобы они не расходились.
 *
 * - область видимости: «leads.view_all» или свой лид (назначен мне либо создан мной);
 * - смена статуса: «leads.status.<целевой>» и, для отката назад, «leads.rollback»;
 * - редактирование карточки: «leads.edit»; только комментарий: «leads.edit» или «leads.comment»;
 * - назначение ответственного: «leads.assign».
 * Полный доступ («*») проходит все проверки. Перевод в «Отмена» для всех требует причину из списка,
 * «Встреча» — дату встречи, «Перезвонить» — дату следующего контакта (051).
 */

/** Порядок статусов в интерфейсе (вкладки, канбан, отчеты) */
export const LEAD_STATUSES: readonly LeadStatus[] = [
  'Открыт',
  'Нет ответа',
  'Обработан',
  'Назначен',
  'Встреча',
  'Перезвонить',
  'Подписан',
  'Отмена',
];

export const CANCELLED_STATUS: LeadStatus = 'Отмена';
export const NO_ANSWER_STATUS: LeadStatus = 'Нет ответа';
export const MEETING_STATUS: LeadStatus = 'Встреча';
export const CALLBACK_STATUS: LeadStatus = 'Перезвонить';

/** Лиды в работе (не подписаны и не отменены) */
export const ACTIVE_LEAD_STATUSES: readonly LeadStatus[] = LEAD_STATUSES.filter(
  (s) => s !== 'Подписан' && s !== 'Отмена'
);

/** Статусы с обязательной датой и поле этой даты */
export type LeadDateField = 'meeting_at' | 'next_contact_at';
export const STATUS_DATE_FIELD: Partial<Record<LeadStatus, LeadDateField>> = {
  Встреча: 'meeting_at',
  Перезвонить: 'next_contact_at',
};

export function statusDateField(status: string | null | undefined): LeadDateField | null {
  return (status && STATUS_DATE_FIELD[status as LeadStatus]) || null;
}

/** Субъект проверки: сотрудник и права его роли */
export interface LeadActor {
  userId: string;
  permissions: string[];
}

export interface LeadScopeInfo {
  created_by?: string | null;
  assigned_to?: string | null;
}

export interface LeadAccessInfo extends LeadScopeInfo {
  status: LeadStatus | string;
  /** Привязанный продавец: пока лид привязан, статус меняется только отвязкой */
  seller_phone?: string | null;
}

/** Статус «Подписан» ставится только привязкой лида к продавцу (046) */
export const LINK_ONLY_STATUS: LeadStatus = 'Подписан';

export type LeadStatusCheck = { ok: true } | { ok: false; reason: string };

/** Построение субъекта из серверного AuthContext (или любого объекта с profile.user_id и permissions) */
export function leadActorFrom(ctx: { permissions: string[]; profile: { user_id: string } }): LeadActor {
  return { userId: ctx.profile.user_id, permissions: ctx.permissions };
}

export function isCancelStatus(status: string | null | undefined): boolean {
  return status === CANCELLED_STATUS;
}

/** Лид в области видимости сотрудника: «leads.view_all» либо назначен ему / создан им */
export function isLeadInScope(actor: LeadActor, lead: LeadScopeInfo): boolean {
  if (hasPermission(actor.permissions, 'leads.view_all')) return true;
  return (
    (Boolean(lead.assigned_to) && lead.assigned_to === actor.userId) ||
    (Boolean(lead.created_by) && lead.created_by === actor.userId)
  );
}

function canReachStatus(actor: LeadActor, from: LeadStatus | string, to: LeadStatus): boolean {
  if (to === LINK_ONLY_STATUS) return false;
  if (!hasPermission(actor.permissions, `leads.status.${to}`)) return false;
  if (isLeadStatusRollback(from, to) && !hasPermission(actor.permissions, 'leads.rollback')) return false;
  return true;
}

/** Лид привязан к продавцу: статус меняется только отвязкой продавца (046) */
export function isLeadLinked(lead: Pick<LeadAccessInfo, 'seller_phone'>): boolean {
  return Boolean(lead.seller_phone);
}

/** Статусы, в которые сотрудник может перевести данный лид (без текущего) */
export function allowedLeadTransitions(actor: LeadActor, lead: LeadAccessInfo): LeadStatus[] {
  if (!isLeadInScope(actor, lead)) return [];
  if (isLeadLinked(lead)) return [];
  return LEAD_STATUSES.filter((s) => s !== lead.status && canReachStatus(actor, lead.status, s));
}

/** Проверка конкретного перехода с понятной причиной отказа */
export function canChangeLeadStatus(
  actor: LeadActor,
  lead: LeadAccessInfo,
  target: LeadStatus | string
): LeadStatusCheck {
  if (!LEAD_STATUSES.includes(target as LeadStatus)) {
    return { ok: false, reason: 'Недопустимый статус лида' };
  }
  if (target === lead.status) {
    return { ok: false, reason: 'Лид уже находится в этом статусе' };
  }
  if (!isLeadInScope(actor, lead)) {
    return { ok: false, reason: 'Можно менять статус только своих лидов' };
  }
  if (target === LINK_ONLY_STATUS) {
    return { ok: false, reason: 'Статус «Подписан» ставится привязкой лида к продавцу' };
  }
  if (isLeadLinked(lead)) {
    return { ok: false, reason: 'Лид привязан к продавцу: сначала отвяжите продавца' };
  }
  if (!hasPermission(actor.permissions, `leads.status.${target}`)) {
    return { ok: false, reason: `Недостаточно прав для перевода лида в статус «${target}»` };
  }
  if (isLeadStatusRollback(lead.status, target) && !hasPermission(actor.permissions, 'leads.rollback')) {
    return {
      ok: false,
      reason: isCancelStatus(lead.status)
        ? 'Недостаточно прав для возврата лида из статуса «Отмена»'
        : 'Недостаточно прав для отката лида на более ранний этап воронки',
    };
  }
  return { ok: true };
}

/**
 * Перенос даты встречи или следующего контакта без смены статуса: лид в «Встреча» / «Перезвонить»,
 * в области видимости, не привязан и у сотрудника есть право на этот статус.
 */
export function canRescheduleLead(actor: LeadActor, lead: LeadAccessInfo): LeadStatusCheck {
  if (!statusDateField(lead.status)) return { ok: false, reason: 'Перенос даты — только для статусов «Встреча» и «Перезвонить»' };
  if (!isLeadInScope(actor, lead)) return { ok: false, reason: 'Можно менять только свои лиды' };
  if (isLeadLinked(lead)) return { ok: false, reason: 'Лид привязан к продавцу' };
  if (!hasPermission(actor.permissions, `leads.status.${lead.status}`)) {
    return { ok: false, reason: `Недостаточно прав для статуса «${lead.status}»` };
  }
  return { ok: true };
}

/** Дата встречи или контакта из запроса: ISO-строка в разумном диапазоне или null */
export function parseScheduleDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  const year = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || year < 2020 || year > 2100) return null;
  return d.toISOString();
}

export interface StatusChangeInput {
  cancel_reason?: string | null;
  cancel_reason_code?: string | null;
  meeting_at?: string | null;
  next_contact_at?: string | null;
}

export type StatusChangeBuild =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; code: string; message: string };

/**
 * Поля обновления лида при переводе в статус: причина отмены из списка, дата встречи,
 * дата следующего контакта. Используется маршрутами /status и /batch (и переносом даты).
 */
export function buildStatusChange(status: LeadStatus | string, input: StatusChangeInput): StatusChangeBuild {
  const updates: Record<string, unknown> = { status };
  if (isCancelStatus(status)) {
    const reason = buildCancelReason(input.cancel_reason_code, input.cancel_reason);
    if (!reason.ok) return { ok: false, code: 'CANCEL_REASON_REQUIRED', message: reason.message };
    updates.cancel_reason = reason.text;
    updates.cancel_reason_code = reason.code;
  }
  const dateField = statusDateField(status);
  if (dateField) {
    const date = parseScheduleDate(input[dateField]);
    if (!date) {
      return {
        ok: false,
        code: dateField === 'meeting_at' ? 'MEETING_AT_REQUIRED' : 'NEXT_CONTACT_AT_REQUIRED',
        message:
          dateField === 'meeting_at'
            ? 'Укажите дату и время встречи'
            : 'Укажите дату следующего контакта',
      };
    }
    updates[dateField] = date;
  }
  return { ok: true, updates };
}

/** Ошибка триггера trg_leads_status_dates (051): статус с датой без даты */
export function isStatusDateDbError(err: unknown): boolean {
  const e = err as { hint?: string; message?: string } | null;
  return Boolean(e && /meeting_at_required|next_contact_at_required/.test(`${e.hint || ''} ${e.message || ''}`));
}

/**
 * Косвенная смена статуса при назначении ответственного:
 * назначение из «Открыт» / «Нет ответа» / «Обработан» → «Назначен»; снятие из «Назначен» → «Обработан».
 */
export function implicitStatusForAssignment(
  current: LeadStatus | string,
  assignedTo: string | null | undefined
): LeadStatus | undefined {
  if (assignedTo && (current === 'Открыт' || current === 'Нет ответа' || current === 'Обработан')) return 'Назначен';
  if (!assignedTo && current === 'Назначен') return 'Обработан';
  return undefined;
}

/** Ошибка триггера БД trg_leads_cancel_reason (миграция 037): отмена без причины */
export function isCancelReasonDbError(err: unknown): boolean {
  const e = err as { hint?: string; message?: string } | null;
  return Boolean(e && (e.hint === 'cancel_reason_required' || /cancel_reason_required/.test(e.message || '')));
}

/** Полное редактирование карточки лида (имя, телефон, Instagram и прочие поля) */
export function canEditLeadFields(actor: LeadActor, lead: LeadScopeInfo): boolean {
  return isLeadInScope(actor, lead) && hasPermission(actor.permissions, 'leads.edit');
}

/** Редактирование комментария (полное редактирование либо отдельное право на комментарий) */
export function canEditLeadComment(actor: LeadActor, lead: LeadScopeInfo): boolean {
  return (
    isLeadInScope(actor, lead) &&
    (hasPermission(actor.permissions, 'leads.edit') || hasPermission(actor.permissions, 'leads.comment'))
  );
}

/** Назначение и снятие ответственного консультанта */
export function canAssignLead(actor: LeadActor): boolean {
  return hasPermission(actor.permissions, 'leads.assign');
}

/**
 * Ответственного у привязанного лида не меняют: им остается консультант подключения продавца (046).
 * Возвращает причину запрета или null.
 */
export function reassignBlockReason(lead: Pick<LeadAccessInfo, 'seller_phone'>): string | null {
  return isLeadLinked(lead)
    ? 'Лид привязан к продавцу: ответственный — консультант подключения. Сначала отвяжите продавца'
    : null;
}
