import { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath, revalidateTag } from 'next/cache';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { deletePlan } from '@/app/plans/actions';

/**
 * Массовые операции над тарифами (plans.manage):
 * { action: 'delete', ids }               — удаление по одному через deletePlan (проверки использования в sellers/connections)
 * { action: 'set_active', ids, is_active } — массовая активация / архивация
 * Ответ: { success: true, affected, errors? }
 */
const BatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    ids: z.array(z.string().trim().min(1)).min(1, 'Выберите хотя бы один тариф').max(500),
  }),
  z.object({
    action: z.literal('set_active'),
    ids: z.array(z.string().trim().min(1)).min(1, 'Выберите хотя бы один тариф').max(500),
    is_active: z.boolean({ message: 'Не указан флаг активности' }),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    await requirePermission('plans.manage');
    const body = await req.json();

    const parsed = BatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Ошибка валидации массовой операции',
        'VALIDATION_ERROR',
        422,
        parsed.error.issues
      );
    }

    const input = parsed.data;
    const uniqueIds = Array.from(new Set(input.ids));

    if (input.action === 'delete') {
      let affected = 0;
      const errors: { plan_id: string; error: string }[] = [];
      for (const planId of uniqueIds) {
        const res = await deletePlan(planId);
        if (res.success) {
          affected += 1;
        } else {
          errors.push({ plan_id: planId, error: res.error || 'Не удалось удалить тариф' });
        }
      }

      if (affected === 0 && errors.length > 0) {
        return apiError(errors[0].error, 'BATCH_FAILED', 400, { errors });
      }
      return apiSuccess({ success: true, affected, errors: errors.length > 0 ? errors : undefined });
    }

    if (input.action === 'set_active') {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from('plans')
        .update({ is_active: input.is_active, updated_at: new Date().toISOString() })
        .in('plan_id', uniqueIds)
        .select('plan_id');
      if (error) throw error;

      revalidateTag('plans');
      revalidatePath('/plans');
      return apiSuccess({ success: true, affected: data?.length || 0 });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
