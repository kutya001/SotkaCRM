import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { TaskCreateSchema } from '@/lib/validations';
import { canAssignTask } from '@/lib/tasks/rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { TASK_SELECT, attachTaskUsers } from '@/lib/tasks/service';

export const dynamic = 'force-dynamic';

/** Список задач (RLS: руководство видит все, остальные — свои) */
export async function GET(req: NextRequest) {
  try {
    const { supabase } = await requireAuth();
    const db = supabase as unknown as SupabaseClient<any>;
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assigned_to');

    let query = db.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false }).limit(2000);
    if (status) query = query.eq('status', status);
    if (assignedTo === 'unassigned') query = query.is('assigned_to', null);
    else if (assignedTo) query = query.eq('assigned_to', assignedTo);

    const { data, error } = await query;
    if (error) throw error;

    const items = await attachTaskUsers((data || []) as any[]);
    return apiSuccess({ items, total: items.length });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Создание задачи: руководство — любому, остальные — себе */
export async function POST(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const input = TaskCreateSchema.parse(body);

    const assignedTo = input.assigned_to ?? null;
    if (assignedTo && assignedTo !== profile.user_id && !canAssignTask(profile.role)) {
      return apiError('Назначать задачи другим сотрудникам может администратор или руководитель', 'FORBIDDEN', 403);
    }

    const db = supabase as unknown as SupabaseClient<any>;
    const { data, error } = await db
      .from('tasks')
      .insert({
        title: input.title,
        description: input.description || null,
        assigned_to: assignedTo,
        due_date: input.due_date || null,
        priority: input.priority,
        created_by: profile.user_id,
      })
      .select(TASK_SELECT)
      .single();
    if (error) throw error;

    scheduleTelegramDispatch();
    const [item] = await attachTaskUsers([data]);
    return apiSuccess(item, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
