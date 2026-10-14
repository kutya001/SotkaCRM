import type { UserRole } from '@/types/database.types';

/**
 * Правила модуля «Задачи»: статусы, переходы по ролям, сроки.
 *  - admin / supervisor: ставят и переназначают задачи любому, любые переходы статусов
 *  - остальные роли: ставят задачи себе; по своим задачам (ответственный или автор)
 *    меняют статус Назначен/Открыт/Отложен → Выполнен | Отложен | Отмена и возвращают
 *    отложенную в работу; закрытые (Выполнен, Отмена) возвращает только руководство
 */

export const TASK_STATUSES = ['Открыт', 'Назначен', 'Выполнен', 'Отложен', 'Отмена'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
};

/** Статусы, в которых задача еще не закрыта (учитываются при контроле сроков) */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['Открыт', 'Назначен', 'Отложен'];

export interface TaskAccessInfo {
  status: TaskStatus | string;
  assigned_to?: string | null;
  created_by?: string | null;
  due_date?: string | null;
}

export function canManageTasks(role: UserRole): boolean {
  return role === 'admin' || role === 'supervisor';
}

export function isTaskOwner(task: TaskAccessInfo, userId: string): boolean {
  return task.assigned_to === userId || task.created_by === userId;
}

export function isOpenTaskStatus(status: string | null | undefined): boolean {
  return OPEN_TASK_STATUSES.includes(status as TaskStatus);
}

/** Просрочена: срок прошел, а задача не закрыта. today — «ГГГГ-ММ-ДД» */
export function isTaskOverdue(task: TaskAccessInfo, today: string): boolean {
  return Boolean(task.due_date) && (task.due_date as string) < today && isOpenTaskStatus(task.status);
}

/** Переходы, доступные роли по данной задаче (без текущего статуса) */
export function allowedTaskTransitions(role: UserRole, task: TaskAccessInfo, userId: string): TaskStatus[] {
  if (canManageTasks(role)) {
    return TASK_STATUSES.filter((s) => s !== task.status);
  }
  if (!isTaskOwner(task, userId)) return [];

  switch (task.status) {
    case 'Открыт':
    case 'Назначен':
      return ['Выполнен', 'Отложен', 'Отмена'];
    case 'Отложен':
      return [task.assigned_to ? 'Назначен' : 'Открыт', 'Выполнен', 'Отмена'];
    default:
      return [];
  }
}

export type TaskCheck = { ok: true } | { ok: false; reason: string };

export function canChangeTaskStatus(role: UserRole, task: TaskAccessInfo, userId: string, target: string): TaskCheck {
  if (!TASK_STATUSES.includes(target as TaskStatus)) {
    return { ok: false, reason: 'Недопустимый статус задачи' };
  }
  if (target === task.status) {
    return { ok: false, reason: 'Задача уже в этом статусе' };
  }
  if (canManageTasks(role)) return { ok: true };
  if (!isTaskOwner(task, userId)) {
    return { ok: false, reason: 'Менять статус можно только по своим задачам' };
  }
  if (!allowedTaskTransitions(role, task, userId).includes(target as TaskStatus)) {
    return {
      ok: false,
      reason:
        task.status === 'Выполнен' || task.status === 'Отмена'
          ? 'Закрытую задачу может вернуть в работу только администратор или руководитель'
          : 'Недопустимый переход статуса',
    };
  }
  return { ok: true };
}

/** Можно ли редактировать поля задачи (название, описание, срок, приоритет) */
export function canEditTaskFields(role: UserRole, task: TaskAccessInfo, userId: string): boolean {
  return canManageTasks(role) || task.created_by === userId;
}

/** Можно ли назначать и переназначать ответственного */
export function canAssignTask(role: UserRole): boolean {
  return canManageTasks(role);
}
