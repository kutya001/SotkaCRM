import type { LeadStatus } from '@/types/database.types';
import { hasPermission } from '../auth/permissions.ts';
import { isLeadStatusRollback } from '../auth/permissions-catalog.ts';

/**
 * Единые правила работы с лидами по правам доступа (каталог lib/auth/permissions-catalog).
 * Используются и интерфейсом (какие статусы предлагать), и API (что разрешить), чтобы они не расходились.
 *
 * - область видимости: «leads.view_all» или свой лид (назначен мне либо создан мной);
 * - смена статуса: «leads.status.<целевой>» и, для отката назад, «leads.rollback»;
 * - редактирование карточки: «leads.edit»; только комментарий: «leads.edit» или «leads.comment»;
 * - назначение ответственного: «leads.assign».
 * Полный доступ («*») проходит все проверки. Перевод в «Отмена» для всех требует причину.
 */

export const LEAD_STATUSES: readonly LeadStatus[] = ['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'];

export const CANCELLED_STATUS: LeadStatus = 'Отмена';

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
}

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
  if (!hasPermission(actor.permissions, `leads.status.${to}`)) return false;
  if (isLeadStatusRollback(from, to) && !hasPermission(actor.permissions, 'leads.rollback')) return false;
  return true;
}

/** Статусы, в которые сотрудник может перевести данный лид (без текущего) */
export function allowedLeadTransitions(actor: LeadActor, lead: LeadAccessInfo): LeadStatus[] {
  if (!isLeadInScope(actor, lead)) return [];
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
 * Косвенная смена статуса при назначении ответственного:
 * назначение из «Открыт»/«Обработан» → «Назначен»; снятие из «Назначен» → «Обработан».
 */
export function implicitStatusForAssignment(
  current: LeadStatus | string,
  assignedTo: string | null | undefined
): LeadStatus | undefined {
  if (assignedTo && (current === 'Открыт' || current === 'Обработан')) return 'Назначен';
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
