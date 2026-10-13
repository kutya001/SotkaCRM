import type { LeadStatus, UserRole } from '@/types/database.types';

/**
 * Единые правила смены статусов лидов по ролям. Используются и интерфейсом
 * (какие статусы предлагать), и API (что разрешить), чтобы они не расходились.
 *
 * - admin: любой переход, включая возврат из «Отмена»
 * - supervisor: только просмотр
 * - smm: свои лиды; Открыт ↔ Обработан, из обоих — в «Отмена»
 * - consultant: свои лиды; из «Назначен» — в «Подписан» или «Отмена»
 * Перевод в «Отмена» для всех ролей требует причину.
 */

export const LEAD_STATUSES: readonly LeadStatus[] = ['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'];

export const CANCELLED_STATUS: LeadStatus = 'Отмена';

export interface LeadAccessInfo {
  status: LeadStatus | string;
  created_by?: string | null;
  assigned_to?: string | null;
}

export type LeadStatusCheck = { ok: true } | { ok: false; reason: string };

export function isCancelStatus(status: string | null | undefined): boolean {
  return status === CANCELLED_STATUS;
}

const SMM_TRANSITIONS: Partial<Record<string, LeadStatus[]>> = {
  Открыт: ['Обработан', 'Отмена'],
  Обработан: ['Открыт', 'Отмена'],
};

const CONSULTANT_TRANSITIONS: Partial<Record<string, LeadStatus[]>> = {
  Назначен: ['Подписан', 'Отмена'],
};

/** Статусы, в которые роль может перевести данный лид (без текущего) */
export function allowedLeadTransitions(role: UserRole, lead: LeadAccessInfo, userId: string): LeadStatus[] {
  switch (role) {
    case 'admin':
      return LEAD_STATUSES.filter((s) => s !== lead.status);
    case 'smm':
      if (!lead.created_by || lead.created_by !== userId) return [];
      return SMM_TRANSITIONS[lead.status] || [];
    case 'consultant':
      if (!lead.assigned_to || lead.assigned_to !== userId) return [];
      return CONSULTANT_TRANSITIONS[lead.status] || [];
    default:
      return [];
  }
}

/** Проверка конкретного перехода с понятной причиной отказа */
export function canChangeLeadStatus(
  role: UserRole,
  lead: LeadAccessInfo,
  userId: string,
  target: LeadStatus | string
): LeadStatusCheck {
  if (!LEAD_STATUSES.includes(target as LeadStatus)) {
    return { ok: false, reason: 'Недопустимый статус лида' };
  }
  if (target === lead.status) {
    return { ok: false, reason: 'Лид уже находится в этом статусе' };
  }

  switch (role) {
    case 'admin':
      return { ok: true };
    case 'supervisor':
      return { ok: false, reason: 'Руководитель может только просматривать лиды' };
    case 'smm': {
      if (!lead.created_by || lead.created_by !== userId) {
        return { ok: false, reason: 'SMM-специалист может менять статус только своих лидов' };
      }
      if (isCancelStatus(lead.status)) {
        return { ok: false, reason: 'Вернуть лид из статуса «Отмена» может только администратор' };
      }
      if (!(SMM_TRANSITIONS[lead.status] || []).includes(target as LeadStatus)) {
        return {
          ok: false,
          reason: 'SMM-специалисту доступны статусы «Открыт», «Обработан» и «Отмена»; остальные ставит администратор',
        };
      }
      return { ok: true };
    }
    case 'consultant': {
      if (!lead.assigned_to || lead.assigned_to !== userId) {
        return { ok: false, reason: 'Консультант может менять статус только своих лидов' };
      }
      if (isCancelStatus(lead.status)) {
        return { ok: false, reason: 'Вернуть лид из статуса «Отмена» может только администратор' };
      }
      if (!(CONSULTANT_TRANSITIONS[lead.status] || []).includes(target as LeadStatus)) {
        return {
          ok: false,
          reason: 'Консультант переводит лид только из «Назначен» в «Подписан» или «Отмена»',
        };
      }
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'Недостаточно прав для смены статуса' };
  }
}

/**
 * Косвенная смена статуса при назначении ответственного (только администратор):
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

/** Может ли роль редактировать поля лида (имя, телефон, комментарий) */
export function canEditLeadFields(role: UserRole, lead: LeadAccessInfo, userId: string): boolean {
  switch (role) {
    case 'admin':
      return true;
    case 'smm':
      return lead.created_by === userId && (lead.status === 'Открыт' || lead.status === 'Обработан');
    case 'consultant':
      return lead.assigned_to === userId && (lead.status === 'Назначен' || lead.status === 'Подписан');
    default:
      return false;
  }
}
