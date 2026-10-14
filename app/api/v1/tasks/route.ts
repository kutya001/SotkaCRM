import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { TaskCreateSchema } from '@/lib/validations';
import { canAssignTask } from '@/lib/tasks/rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { TASK_SELECT, attachTaskUsers } from '@/lib/tasks/service';

export const dynamic = 'force-dynamic';

/** Список задач: tasks.view_all — все, иначе назначенные мне и созданные мной */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('tasks.menu');
    const db = createAdminClient() as unknown as SupabaseClient<any>;
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assigned_to');

    let query = db.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false }).limit(2000);
    if (!ctx.canViewAll('tasks')) {
      const me = ctx.profile.user_id;
      query = query.or(`assigned_to.eq.${me},created_by.eq.${me}`);
    }
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

/** Создание задачи: себе — tasks.create; другому сотруднику — дополнительно tasks.assign */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('tasks.create');
    const { profile } = ctx;
    const body = await req.json().catch(() => ({}));
    const input = TaskCreateSchema.parse(body);

    const actor = { userId: profile.user_id, permissions: ctx.permissions };
    const assignedTo = input.assigned_to ?? null;
    if (assignedTo && assignedTo !== profile.user_id && !canAssignTask(actor)) {
      return apiError('Недостаточно прав: назначать задачи другим сотрудникам', 'FORBIDDEN', 403);
    }

    const db = createAdminClient() as unknown as SupabaseClient<any>;
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
