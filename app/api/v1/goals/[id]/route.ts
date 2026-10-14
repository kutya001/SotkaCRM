import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { ConnectionPlanUpdateSchema } from '@/lib/validations';
import { PLAN_SELECT, withPlanProgress } from '@/lib/plans/progress';

export const dynamic = 'force-dynamic';

/** Изменение цели или примечания плана (администратор) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const input = ConnectionPlanUpdateSchema.parse(body);
    const db = supabase as unknown as SupabaseClient<any>;

    const updates: Record<string, unknown> = {};
    if (input.target_count !== undefined) updates.target_count = input.target_count;
    if (input.note !== undefined) updates.note = input.note || null;

    const { data, error } = await db.from('connection_plans').update(updates).eq('plan_id', id).select(PLAN_SELECT).maybeSingle();
    if (error) throw error;
    if (!data) return apiError('План не найден', 'NOT_FOUND', 404);

    const [item] = await withPlanProgress([data]);
    return apiSuccess(item);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Удаление плана (администратор) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireAdmin();
    const db = supabase as unknown as SupabaseClient<any>;
    const { data, error } = await db.from('connection_plans').delete().eq('plan_id', id).select('plan_id');
    if (error) throw error;
    if (!data || data.length === 0) return apiError('План не найден', 'NOT_FOUND', 404);
    return apiSuccess({ success: true, plan_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
