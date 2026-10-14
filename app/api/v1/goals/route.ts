import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { ConnectionPlanSchema } from '@/lib/validations';
import { normalizePeriodStart, periodEnd } from '@/lib/plans/periods';
import { todayISODate } from '@/lib/utils/format';
import { PLAN_SELECT, withPlanProgress, type PlanRow, type PlanUserRef as UserRef } from '@/lib/plans/progress';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

/** Планы с фактом: goals.view_all — все, иначе общие и свои персональные */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('goals.menu');
    const { profile } = ctx;

    const admin = db();
    const { searchParams } = req.nextUrl;
    const kind = searchParams.get('period_kind');
    const userId = searchParams.get('user_id');

    let query = admin.from('connection_plans').select(PLAN_SELECT).order('period_start', { ascending: false }).limit(2000);
    if (!ctx.canViewAll('goals')) {
      query = query.or(`scope.eq.team,user_id.eq.${profile.user_id}`);
    }
    if (kind) query = query.eq('period_kind', kind);
    if (userId === 'team') query = query.eq('scope', 'team');
    else if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;

    const items = await withPlanProgress((data || []) as PlanRow[]);

    // Сотрудники для выбора при постановке плана (и для назначения задач — страница задач переиспользует список)
    let employees: UserRef[] = [];
    if (ctx.canAny(['goals.manage', 'tasks.assign'])) {
      const { data: users } = await admin
        .from('users')
        .select('user_id, full_name, login, role, color, is_active')
        .eq('is_active', true)
        .in('role', ['consultant', 'admin', 'supervisor'])
        .order('full_name');
      employees = (users || []) as UserRef[];
    }

    return apiSuccess({ items, total: items.length, employees, today: todayISODate() });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Постановка плана (goals.manage); повторная постановка на тот же период обновляет цель */
export async function POST(req: NextRequest) {
  try {
    const { profile } = await requirePermission('goals.manage');
    const body = await req.json().catch(() => ({}));
    const input = ConnectionPlanSchema.parse(body);

    const start = normalizePeriodStart(input.period_kind, input.period_date);
    const end = periodEnd(input.period_kind, start);
    const admin = db();

    let existing = admin
      .from('connection_plans')
      .select('plan_id')
      .eq('scope', input.scope)
      .eq('period_kind', input.period_kind)
      .eq('period_start', start);
    existing = input.scope === 'team' ? existing.is('user_id', null) : existing.eq('user_id', input.user_id);
    const { data: found } = await existing.maybeSingle();

    const payload = {
      scope: input.scope,
      user_id: input.scope === 'team' ? null : input.user_id,
      period_kind: input.period_kind,
      period_start: start,
      period_end: end,
      target_count: input.target_count,
      note: input.note || null,
      created_by: profile.user_id,
    };

    const { data, error } = found
      ? await admin.from('connection_plans').update(payload).eq('plan_id', found.plan_id).select(PLAN_SELECT).single()
      : await admin.from('connection_plans').insert(payload).select(PLAN_SELECT).single();
    if (error) throw error;

    const [item] = await withPlanProgress([data as PlanRow]);
    return apiSuccess({ ...item, replaced: Boolean(found) }, found ? 200 : 201);
  } catch (err) {
    return handleApiError(err);
  }
}
