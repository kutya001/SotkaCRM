import { hasPermission } from '../auth/permissions.ts';

/**
 * Правила модуля «Задачи»: статусы, переходы по правам, сроки.
 *  - tasks.assign: ставит и переназначает задачи любому сотруднику
 *  - tasks.edit_any: редактирует поля чужих задач
 *  - tasks.status_any: любые переходы статусов по любой задаче
 *  - tasks.delete: удаляет любые задачи (автор удаляет свои всегда)
 *  - tasks.view_all: видит все задачи (иначе — назначенные мне и созданные мной)
 *  - без спец. прав: по своим задачам (ответственный или автор) меняет статус
 *    Назначен/Открыт/Отложен → Выполнен | Отложен | Отмена и возвращает отложенную
 *    в работу; закрытые (Выполнен, Отмена) возвращает только обладатель tasks.status_any
 *
 * Чистый модуль: используется сервером и клиентом. Полный доступ («*») проходит все проверки.
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

export interface TaskActor {
  userId: string;
  permissions: string[];
}

export interface TaskAccessInfo {
  status: TaskStatus | string;
  assigned_to?: string | null;
  created_by?: string | null;
  due_date?: string | null;
}

/** Руководящие права по задачам (совместимость: раньше — admin/supervisor) */
export function canManageTasks(actor: TaskActor): boolean {
  return (
    hasPermission(actor.permissions, 'tasks.edit_any') ||
    hasPermission(actor.permissions, 'tasks.status_any') ||
    hasPermission(actor.permissions, 'tasks.assign')
  );
}

export function isTaskOwner(task: TaskAccessInfo, userId: string): boolean {
  return task.assigned_to === userId || task.created_by === userId;
}

/** Видна ли задача сотруднику: tasks.view_all либо он ответственный или автор */
export function isTaskInScope(actor: TaskActor, task: TaskAccessInfo): boolean {
  return hasPermission(actor.permissions, 'tasks.view_all') || isTaskOwner(task, actor.userId);
}

export function isOpenTaskStatus(status: string | null | undefined): boolean {
  return OPEN_TASK_STATUSES.includes(status as TaskStatus);
}

/** Просрочена: срок прошел, а задача не закрыта. today — «ГГГГ-ММ-ДД» */
export function isTaskOverdue(task: TaskAccessInfo, today: string): boolean {
  return Boolean(task.due_date) && (task.due_date as string) < today && isOpenTaskStatus(task.status);
}

/** Переходы, доступные сотруднику по данной задаче (без текущего статуса) */
export function allowedTaskTransitions(actor: TaskActor, task: TaskAccessInfo): TaskStatus[] {
  if (hasPermission(actor.permissions, 'tasks.status_any')) {
    return TASK_STATUSES.filter((s) => s !== task.status);
  }
  if (!isTaskOwner(task, actor.userId)) return [];

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

export function canChangeTaskStatus(actor: TaskActor, task: TaskAccessInfo, target: string): TaskCheck {
  if (!TASK_STATUSES.includes(target as TaskStatus)) {
    return { ok: false, reason: 'Недопустимый статус задачи' };
  }
  if (target === task.status) {
    return { ok: false, reason: 'Задача уже в этом статусе' };
  }
  if (hasPermission(actor.permissions, 'tasks.status_any')) return { ok: true };
  if (!isTaskOwner(task, actor.userId)) {
    return { ok: false, reason: 'Менять статус можно только по своим задачам' };
  }
  if (!allowedTaskTransitions(actor, task).includes(target as TaskStatus)) {
    return {
      ok: false,
      reason:
        task.status === 'Выполнен' || task.status === 'Отмена'
          ? 'Закрытую задачу может вернуть в работу только сотрудник с правом менять статус чужих задач'
          : 'Недопустимый переход статуса',
    };
  }
  return { ok: true };
}

/** Можно ли редактировать поля задачи (название, описание, срок, приоритет) */
export function canEditTaskFields(actor: TaskActor, task: TaskAccessInfo): boolean {
  return hasPermission(actor.permissions, 'tasks.edit_any') || task.created_by === actor.userId;
}

/** Можно ли назначать и переназначать ответственного */
export function canAssignTask(actor: TaskActor): boolean {
  return hasPermission(actor.permissions, 'tasks.assign');
}

/** Можно ли удалить задачу: право tasks.delete либо автор */
export function canDeleteTask(actor: TaskActor, task: TaskAccessInfo): boolean {
  return hasPermission(actor.permissions, 'tasks.delete') || task.created_by === actor.userId;
}
