import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { ConnectionPlanUpdateSchema } from '@/lib/validations';
import { PLAN_SELECT, withPlanProgress } from '@/lib/plans/progress';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

/** Изменение цели или примечания плана (goals.manage) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requirePermission('goals.manage');
    const body = await req.json().catch(() => ({}));
    const input = ConnectionPlanUpdateSchema.parse(body);

    const updates: Record<string, unknown> = {};
    if (input.target_count !== undefined) updates.target_count = input.target_count;
    if (input.note !== undefined) updates.note = input.note || null;

    const { data, error } = await db().from('connection_plans').update(updates).eq('plan_id', id).select(PLAN_SELECT).maybeSingle();
    if (error) throw error;
    if (!data) return apiError('План не найден', 'NOT_FOUND', 404);

    const [item] = await withPlanProgress([data]);
    return apiSuccess(item);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Удаление плана (goals.manage) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requirePermission('goals.manage');
    const { data, error } = await db().from('connection_plans').delete().eq('plan_id', id).select('plan_id');
    if (error) throw error;
    if (!data || data.length === 0) return apiError('План не найден', 'NOT_FOUND', 404);
    return apiSuccess({ success: true, plan_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
