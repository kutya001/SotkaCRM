import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { planProgressStatus, periodElapsedShare, type PlanPeriodKind } from '@/lib/plans/periods';
import { todayISODate } from '@/lib/utils/format';

export const PLAN_SELECT = 'plan_id, scope, user_id, period_kind, period_start, period_end, target_count, note, created_by, created_at, updated_at';

export interface PlanRow {
  plan_id: string;
  scope: 'personal' | 'team';
  user_id: string | null;
  period_kind: PlanPeriodKind;
  period_start: string;
  period_end: string;
  target_count: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanUserRef {
  user_id: string;
  full_name: string;
  login: string;
  role: string;
  color: string | null;
  is_active: boolean;
}

/**
 * Факт по планам: подтвержденные подключения (connections.confirmation_status = confirmed)
 * по дате назначения куратора внутри периода; персональные — по manager_id, общие — все.
 */
export async function withPlanProgress(plans: PlanRow[]) {
  const admin = createAdminClient() as unknown as SupabaseClient<any>;
  const today = todayISODate();

  const userIds = Array.from(new Set(plans.map((p) => p.user_id).filter((id): id is string => Boolean(id))));
  const { data: users } = userIds.length
    ? await admin.from('users').select('user_id, full_name, login, role, color, is_active').in('user_id', userIds)
    : { data: [] as PlanUserRef[] };
  const usersMap = new Map<string, PlanUserRef>(((users || []) as PlanUserRef[]).map((u) => [u.user_id, u]));

  let connections: { manager_id: string | null; assigned_at: string }[] = [];
  if (plans.length > 0) {
    const minStart = plans.reduce((m, p) => (p.period_start < m ? p.period_start : m), plans[0].period_start);
    const maxEnd = plans.reduce((m, p) => (p.period_end > m ? p.period_end : m), plans[0].period_end);
    const { data } = await admin
      .from('connections')
      .select('manager_id, assigned_at')
      .eq('confirmation_status', 'confirmed')
      .not('manager_id', 'is', null)
      .gte('assigned_at', `${minStart}T00:00:00+06:00`)
      .lt('assigned_at', `${maxEnd}T00:00:00+06:00`);
    connections = (data || []) as typeof connections;
  }

  // Дата подключения в поясе Бишкека как «ГГГГ-ММ-ДД»
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dated = connections.map((c) => ({ manager_id: c.manager_id, day: fmt.format(new Date(c.assigned_at)) }));

  return plans.map((p) => {
    const actual = dated.filter(
      (c) => c.day >= p.period_start && c.day < p.period_end && (p.scope === 'team' || c.manager_id === p.user_id)
    ).length;
    const status = planProgressStatus(actual, p.target_count, p.period_start, p.period_end, today);
    const percent = p.target_count > 0 ? Math.min(999, Math.round((actual / p.target_count) * 100)) : 0;
    return {
      ...p,
      user: p.user_id ? usersMap.get(p.user_id) || null : null,
      actual_count: actual,
      percent,
      remaining: Math.max(0, p.target_count - actual),
      progress_status: status,
      elapsed_share: periodElapsedShare(p.period_start, p.period_end, today),
    };
  });
}

