import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { isTaskOverdue } from '@/lib/tasks/rules';
import { todayISODate } from '@/lib/utils/format';

export const TASK_SELECT =
  'task_id, title, description, status, priority, assigned_to, created_by, due_date, completed_at, result_note, created_at, updated_at';

export interface TaskUserRef {
  user_id: string;
  full_name: string;
  login: string;
  role: string;
  color: string | null;
}

/** Имена ответственного и автора по идентификаторам (одним запросом) */
export async function attachTaskUsers<T extends { assigned_to: string | null; created_by: string }>(rows: T[]) {
  const ids = Array.from(new Set(rows.flatMap((r) => [r.assigned_to, r.created_by]).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return rows.map((r) => ({ ...r, assigned_user: null, creator: null }));

  const admin = createAdminClient() as unknown as SupabaseClient<any>;
  const { data } = await admin.from('users').select('user_id, full_name, login, role, color').in('user_id', ids);
  const map = new Map<string, TaskUserRef>(((data || []) as TaskUserRef[]).map((u) => [u.user_id, u]));
  const today = todayISODate();
  return rows.map((r) => ({
    ...r,
    assigned_user: r.assigned_to ? map.get(r.assigned_to) || null : null,
    creator: map.get(r.created_by) || null,
    is_overdue: isTaskOverdue(r as any, today),
  }));
}

