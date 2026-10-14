import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { PG_UUID_REGEX, TaskStatusSchema } from '@/lib/validations';
import { canAssignTask, canChangeTaskStatus, canDeleteTask, isTaskInScope, type TaskActor } from '@/lib/tasks/rules';
import { TASK_SELECT } from '@/lib/tasks/service';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

const TasksBatchSchema = z
  .object({
    action: z.enum(['change_status', 'change_assigned', 'delete']),
    ids: z
      .array(z.string().regex(PG_UUID_REGEX, 'Неверный идентификатор задачи'))
      .min(1, 'Выберите хотя бы одну задачу')
      .max(500, 'За один раз можно обработать не более 500 задач'),
    status: TaskStatusSchema.optional(),
    assigned_to: z.string().regex(PG_UUID_REGEX, 'Неверный идентификатор сотрудника').nullable().optional(),
  })
  .refine((v) => v.action !== 'change_status' || Boolean(v.status), { message: 'Не указан новый статус', path: ['status'] })
  .refine((v) => v.action !== 'change_assigned' || v.assigned_to !== undefined, {
    message: 'Не указан ответственный',
    path: ['assigned_to'],
  });

interface TaskRow {
  task_id: string;
  status: string;
  assigned_to: string | null;
  created_by: string;
  due_date: string | null;
}

type Skipped = { task_id: string; reason: string };

/**
 * Массовые действия над задачами: смена статуса, смена ответственного, удаление.
 * Права проверяются по каждой задаче (те же правила, что в PATCH/DELETE /tasks/[id]);
 * задачи, по которым действие недоступно, попадают в skipped с причиной, а не ломают весь пакет.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('tasks.menu');
    const actor: TaskActor = { userId: ctx.profile.user_id, permissions: ctx.permissions };
    const body = await req.json().catch(() => ({}));

    const parsed = TasksBatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации пакетной операции', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const { action, ids } = parsed.data;
    const uniqueIds = Array.from(new Set(ids));
    const admin = db();

    const { data: rows, error: readError } = await admin.from('tasks').select(TASK_SELECT).in('task_id', uniqueIds);
    if (readError) throw readError;

    const tasks = (rows || []) as TaskRow[];
    const found = new Set(tasks.map((t) => t.task_id));
    const skipped: Skipped[] = uniqueIds.filter((id) => !found.has(id)).map((task_id) => ({ task_id, reason: 'Задача не найдена' }));

    const inScope: TaskRow[] = [];
    for (const task of tasks) {
      if (isTaskInScope(actor, task)) inScope.push(task);
      else skipped.push({ task_id: task.task_id, reason: 'Задача вне вашей области видимости' });
    }

    let affected = 0;

    if (action === 'change_status') {
      const status = parsed.data.status as string;
      const allowed: string[] = [];
      for (const task of inScope) {
        const check = canChangeTaskStatus(actor, task, status);
        if (check.ok) allowed.push(task.task_id);
        else skipped.push({ task_id: task.task_id, reason: check.reason });
      }
      if (allowed.length > 0) {
        const { data, error } = await admin.from('tasks').update({ status }).in('task_id', allowed).select('task_id');
        if (error) throw error;
        affected = data?.length || 0;
      }
      scheduleTelegramDispatch();
      return apiSuccess({ success: true, action, affected, skipped });
    }

    if (action === 'change_assigned') {
      const assignedTo = parsed.data.assigned_to ?? null;
      if (!canAssignTask(actor)) {
        for (const task of inScope) {
          skipped.push({ task_id: task.task_id, reason: 'Недостаточно прав: назначать и переназначать ответственного' });
        }
        return apiSuccess({ success: true, action, affected: 0, skipped });
      }
      const allowed: string[] = [];
      for (const task of inScope) {
        if (task.assigned_to === assignedTo) skipped.push({ task_id: task.task_id, reason: 'Ответственный уже назначен' });
        else allowed.push(task.task_id);
      }
      if (allowed.length > 0) {
        const { data, error } = await admin.from('tasks').update({ assigned_to: assignedTo }).in('task_id', allowed).select('task_id');
        if (error) throw error;
        affected = data?.length || 0;
      }
      // Смена ответственного ставит уведомление в очередь Telegram (как в PATCH)
      scheduleTelegramDispatch();
      return apiSuccess({ success: true, action, affected, skipped, assigned_to: assignedTo });
    }

    if (action === 'delete') {
      const allowed: string[] = [];
      for (const task of inScope) {
        if (canDeleteTask(actor, task)) allowed.push(task.task_id);
        else skipped.push({ task_id: task.task_id, reason: 'Удалить задачу может ее автор или сотрудник с правом удалять задачи' });
      }
      if (allowed.length > 0) {
        const { data, error } = await admin.from('tasks').delete().in('task_id', allowed).select('task_id');
        if (error) throw error;
        affected = data?.length || 0;
      }
      return apiSuccess({ success: true, action, affected, skipped });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
