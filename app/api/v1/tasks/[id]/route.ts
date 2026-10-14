import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { TaskUpdateSchema } from '@/lib/validations';
import { canAssignTask, canChangeTaskStatus, canEditTaskFields, canManageTasks } from '@/lib/tasks/rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { TASK_SELECT, attachTaskUsers } from '@/lib/tasks/service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireAuth();
    const db = supabase as unknown as SupabaseClient<any>;
    const { data, error } = await db.from('tasks').select(TASK_SELECT).eq('task_id', id).maybeSingle();
    if (error) throw error;
    if (!data) return apiError('Задача не найдена', 'NOT_FOUND', 404);
    const [item] = await attachTaskUsers([data]);
    return apiSuccess(item);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Изменение задачи: поля — автор или руководство; ответственный — руководство; статус — по правилам */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, profile } = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const input = TaskUpdateSchema.parse(body);
    const db = supabase as unknown as SupabaseClient<any>;

    const { data: task, error: getErr } = await db.from('tasks').select(TASK_SELECT).eq('task_id', id).maybeSingle();
    if (getErr) throw getErr;
    if (!task) return apiError('Задача не найдена', 'NOT_FOUND', 404);

    const updates: Record<string, unknown> = {};

    const fieldKeys = ['title', 'description', 'due_date', 'priority'] as const;
    const touchesFields = fieldKeys.some((k) => input[k] !== undefined);
    if (touchesFields && !canEditTaskFields(profile.role, task, profile.user_id)) {
      return apiError('Редактировать задачу может ее автор, администратор или руководитель', 'FORBIDDEN', 403);
    }
    for (const k of fieldKeys) {
      if (input[k] !== undefined) updates[k] = input[k];
    }

    if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) {
      if (!canAssignTask(profile.role)) {
        return apiError('Назначать и переназначать ответственного может администратор или руководитель', 'FORBIDDEN', 403);
      }
      updates.assigned_to = input.assigned_to;
    }

    if (input.status !== undefined && input.status !== task.status) {
      const check = canChangeTaskStatus(profile.role, task, profile.user_id, input.status);
      if (!check.ok) return apiError(check.reason, 'FORBIDDEN', 403);
      updates.status = input.status;
    }

    if (input.result_note !== undefined) {
      if (!canManageTasks(profile.role) && task.assigned_to !== profile.user_id && task.created_by !== profile.user_id) {
        return apiError('Комментарий к задаче оставляет ответственный или автор', 'FORBIDDEN', 403);
      }
      updates.result_note = input.result_note || null;
    }

    if (Object.keys(updates).length === 0) {
      const [item] = await attachTaskUsers([task]);
      return apiSuccess(item);
    }

    const { data: updated, error } = await db.from('tasks').update(updates).eq('task_id', id).select(TASK_SELECT).single();
    if (error) throw error;

    scheduleTelegramDispatch();
    const [item] = await attachTaskUsers([updated]);
    return apiSuccess(item);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Удаление: администратор или автор задачи (RLS) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, profile } = await requireAuth();
    const db = supabase as unknown as SupabaseClient<any>;

    const { data: task } = await db.from('tasks').select('task_id, created_by').eq('task_id', id).maybeSingle();
    if (!task) return apiError('Задача не найдена', 'NOT_FOUND', 404);
    if (profile.role !== 'admin' && task.created_by !== profile.user_id) {
      return apiError('Удалить задачу может администратор или ее автор', 'FORBIDDEN', 403);
    }

    const { error } = await db.from('tasks').delete().eq('task_id', id);
    if (error) throw error;
    return apiSuccess({ success: true, task_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
