import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { SellersBatchActionSchema } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { assignSellerManager } from '@/app/sellers/actions';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await req.json();

    const parsed = SellersBatchActionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Ошибка валидации пакетной операции продавцов',
        'VALIDATION_ERROR',
        422,
        parsed.error.issues
      );
    }

    const action = parsed.data.action;
    const targetSellerIds = (parsed.data.seller_ids || parsed.data.ids || []) as string[];
    const manager_id = parsed.data.manager_id !== undefined ? parsed.data.manager_id : parsed.data.payload?.manager_id;

    if (action === 'change_manager') {
      const normalizedManagerId = manager_id || null;
      let successCount = 0;
      const errors: string[] = [];

      for (const sellerId of targetSellerIds) {
        const res = await assignSellerManager(sellerId, normalizedManagerId);
        if (res.success) {
          successCount++;
        } else {
          errors.push(`${sellerId}: ${res.error || 'Ошибка назначения'}`);
        }
      }

      return apiSuccess({
        success: true,
        action,
        affected_count: successCount,
        errors: errors.length > 0 ? errors : undefined,
        manager_id: normalizedManagerId,
        ids: targetSellerIds,
      });
    }

    if (action === 'delete') {
      const { error } = await supabase
        .from('sellers')
        .delete()
        .in('seller_phone', targetSellerIds);

      if (error) {
        // Попытка по organization_id если seller_ids содержат UUID/организации
        const { error: orgError } = await supabase
          .from('sellers')
          .delete()
          .in('organization_id', targetSellerIds);

        if (orgError) throw orgError;
      }

      return apiSuccess({
        success: true,
        action,
        affected_count: targetSellerIds.length,
        ids: targetSellerIds,
      });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
