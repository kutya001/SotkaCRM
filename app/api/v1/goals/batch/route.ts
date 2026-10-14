import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { PG_UUID_REGEX } from '@/lib/validations';

export const dynamic = 'force-dynamic';

function db(): SupabaseClient<any> {
  return createAdminClient() as unknown as SupabaseClient<any>;
}

const GoalsBatchSchema = z
  .object({
    action: z.enum(['delete', 'set_target']),
    ids: z
      .array(z.string().regex(PG_UUID_REGEX, 'Неверный идентификатор плана'))
      .min(1, 'Выберите хотя бы один план')
      .max(500, 'За один раз можно обработать не более 500 планов'),
    target_count: z.coerce.number().int('План — целое число').min(1, 'План должен быть больше нуля').max(100000).optional(),
  })
  .refine((v) => v.action !== 'set_target' || v.target_count !== undefined, {
    message: 'Укажите новое значение плана',
    path: ['target_count'],
  });

/** Массовые действия над планами (goals.manage): delete, set_target */
export async function POST(req: NextRequest) {
  try {
    await requirePermission('goals.manage');
    const body = await req.json().catch(() => ({}));

    const parsed = GoalsBatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации пакетной операции', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const { action } = parsed.data;
    const ids = Array.from(new Set(parsed.data.ids));
    const admin = db();

    if (action === 'delete') {
      const { data, error } = await admin.from('connection_plans').delete().in('plan_id', ids).select('plan_id');
      if (error) throw error;
      return apiSuccess({ success: true, action, affected: data?.length || 0 });
    }

    if (action === 'set_target') {
      const target_count = parsed.data.target_count as number;
      const { data, error } = await admin.from('connection_plans').update({ target_count }).in('plan_id', ids).select('plan_id');
      if (error) throw error;
      return apiSuccess({ success: true, action, affected: data?.length || 0, target_count });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
