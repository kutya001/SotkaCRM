import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { ConnectionPlanSchema } from '@/lib/validations';
import { normalizePeriodStart, periodEnd } from '@/lib/plans/periods';
import { todayISODate } from '@/lib/utils/format';
import { PLAN_SELECT, withPlanProgress, type PlanRow, type PlanUserRef as UserRef } from '@/lib/plans/progress';

export const dynamic = 'force-dynamic';

/** Планы с фактом (RLS: руководство — все, консультант — общие и свои) */
export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();
    if (profile.role === 'smm') return apiError('Модуль планов недоступен для роли SMM', 'FORBIDDEN', 403);

    const db = supabase as unknown as SupabaseClient<any>;
    const { searchParams } = req.nextUrl;
    const kind = searchParams.get('period_kind');
    const userId = searchParams.get('user_id');

    let query = db.from('connection_plans').select(PLAN_SELECT).order('period_start', { ascending: false }).limit(2000);
    if (kind) query = query.eq('period_kind', kind);
    if (userId === 'team') query = query.eq('scope', 'team');
    else if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;

    const items = await withPlanProgress((data || []) as PlanRow[]);

    // Консультанты для выбора при постановке плана (администратор)
    let employees: UserRef[] = [];
    if (profile.role === 'admin' || profile.role === 'supervisor') {
      const admin = createAdminClient() as unknown as SupabaseClient<any>;
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

/** Постановка плана администратором; повторная постановка на тот же период обновляет цель */
export async function POST(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const input = ConnectionPlanSchema.parse(body);

    const start = normalizePeriodStart(input.period_kind, input.period_date);
    const end = periodEnd(input.period_kind, start);
    const db = supabase as unknown as SupabaseClient<any>;

    let existing = db
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
      ? await db.from('connection_plans').update(payload).eq('plan_id', found.plan_id).select(PLAN_SELECT).single()
      : await db.from('connection_plans').insert(payload).select(PLAN_SELECT).single();
    if (error) throw error;

    const [item] = await withPlanProgress([data as PlanRow]);
    return apiSuccess({ ...item, replaced: Boolean(found) }, found ? 200 : 201);
  } catch (err) {
    return handleApiError(err);
  }
}
