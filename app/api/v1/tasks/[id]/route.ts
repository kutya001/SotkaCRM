import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { TaskUpdateSchema } from '@/lib/validations';
import {
  canAssignTask,
  canChangeTaskStatus,
  canDeleteTask,
  canEditTaskFields,
  isTaskInScope,
  type TaskActor,
} from '@/lib/tasks/rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { TASK_SELECT, attachTaskUsers } from '@/lib/tasks/service';
import { hasPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('tasks.menu');
    const actor: TaskActor = { userId: ctx.profile.user_id, permissions: ctx.permissions };

    const { data, error } = await db().from('tasks').select(TASK_SELECT).eq('task_id', id).maybeSingle();
    if (error) throw error;
    if (!data) return apiError('Задача не найдена', 'NOT_FOUND', 404);
    if (!isTaskInScope(actor, data)) return apiError('Задача вне вашей области видимости', 'FORBIDDEN', 403);

    const [item] = await attachTaskUsers([data]);
    return apiSuccess(item);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Изменение задачи: поля — автор или tasks.edit_any; ответственный — tasks.assign; статус — по правилам */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('tasks.menu');
    const { profile } = ctx;
    const actor: TaskActor = { userId: profile.user_id, permissions: ctx.permissions };
    const body = await req.json().catch(() => ({}));
    const input = TaskUpdateSchema.parse(body);
    const admin = db();

    const { data: task, error: getErr } = await admin.from('tasks').select(TASK_SELECT).eq('task_id', id).maybeSingle();
    if (getErr) throw getErr;
    if (!task) return apiError('Задача не найдена', 'NOT_FOUND', 404);
    if (!isTaskInScope(actor, task)) return apiError('Задача вне вашей области видимости', 'FORBIDDEN', 403);

    const updates: Record<string, unknown> = {};

    const fieldKeys = ['title', 'description', 'due_date', 'priority'] as const;
    const touchesFields = fieldKeys.some((k) => input[k] !== undefined);
    if (touchesFields && !canEditTaskFields(actor, task)) {
      return apiError('Редактировать задачу может ее автор или сотрудник с правом редактировать чужие задачи', 'FORBIDDEN', 403);
    }
    for (const k of fieldKeys) {
      if (input[k] !== undefined) updates[k] = input[k];
    }

    if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) {
      if (!canAssignTask(actor)) {
        return apiError('Недостаточно прав: назначать и переназначать ответственного', 'FORBIDDEN', 403);
      }
      updates.assigned_to = input.assigned_to;
    }

    if (input.status !== undefined && input.status !== task.status) {
      const check = canChangeTaskStatus(actor, task, input.status);
      if (!check.ok) return apiError(check.reason, 'FORBIDDEN', 403);
      updates.status = input.status;
    }

    if (input.result_note !== undefined) {
      const isOwner = task.assigned_to === profile.user_id || task.created_by === profile.user_id;
      if (!hasPermission(ctx.permissions, 'tasks.edit_any') && !isOwner) {
        return apiError('Комментарий к задаче оставляет ответственный или автор', 'FORBIDDEN', 403);
      }
      updates.result_note = input.result_note || null;
    }

    if (Object.keys(updates).length === 0) {
      const [item] = await attachTaskUsers([task]);
      return apiSuccess(item);
    }

    const { data: updated, error } = await admin.from('tasks').update(updates).eq('task_id', id).select(TASK_SELECT).single();
    if (error) throw error;

    scheduleTelegramDispatch();
    const [item] = await attachTaskUsers([updated]);
    return apiSuccess(item);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Удаление: право tasks.delete или автор задачи */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('tasks.menu');
    const actor: TaskActor = { userId: ctx.profile.user_id, permissions: ctx.permissions };
    const admin = db();

    const { data: task } = await admin.from('tasks').select('task_id, status, assigned_to, created_by').eq('task_id', id).maybeSingle();
    if (!task) return apiError('Задача не найдена', 'NOT_FOUND', 404);
    if (!isTaskInScope(actor, task)) return apiError('Задача вне вашей области видимости', 'FORBIDDEN', 403);
    if (!canDeleteTask(actor, task)) {
      return apiError('Удалить задачу может ее автор или сотрудник с правом удалять задачи', 'FORBIDDEN', 403);
    }

    const { error } = await admin.from('tasks').delete().eq('task_id', id);
    if (error) throw error;
    return apiSuccess({ success: true, task_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
