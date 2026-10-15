import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSellerByKey } from '@/lib/services/sellers';
import { assignSellerToManager } from '@/lib/services/connections';
import { notifyConnectionPendingToAdmins } from '@/lib/services/connection-notifications';

/**
 * «Взять себе»: сотрудник с правом «sellers.take» становится консультантом свободного одобренного продавца.
 * Подключение создается в статусе pending — начисление за подключение произойдет
 * только после подтверждения (миграция 037). Если у сотрудника есть право
 * «connections.confirm», подключение подтверждается сразу.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('sellers.take');
    const { profile } = ctx;
    const supabase = createAdminClient();

    const seller = await findSellerByKey(supabase, id, ['seller_phone', 'manager_id', 'moderation'] as const);
    if (!seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }
    if (seller.manager_id) {
      return apiError(
        seller.manager_id === profile.user_id ? 'Этот продавец уже закреплен за вами' : 'У продавца уже есть консультант',
        'SELLER_ALREADY_TAKEN',
        409
      );
    }

    const autoConfirm = ctx.can('connections.confirm');

    const res = await assignSellerToManager({
      sellerPhone: seller.seller_phone,
      managerId: profile.user_id,
      actor: profile,
      confirmation: autoConfirm ? 'confirmed' : 'pending',
      expectUnassigned: true,
      requireApproved: true,
    });

    if (!res.success) {
      return apiError(res.error, res.code, res.status);
    }

    // Ожидает подтверждения: запрос администраторам с одноразовой ссылкой (044)
    if (!autoConfirm && res.connectionId) {
      await notifyConnectionPendingToAdmins({ connectionId: res.connectionId, appOrigin: req.nextUrl.origin }).catch((err) =>
        console.warn('[take] Уведомление администраторам не отправлено:', err)
      );
    }

    return apiSuccess({
      success: true,
      seller_phone: seller.seller_phone,
      manager_id: profile.user_id,
      connection_id: res.connectionId,
      confirmation_status: res.confirmationStatus,
      message: autoConfirm
        ? 'Продавец закреплен за вами. Подключение подтверждено'
        : 'Продавец закреплен за вами. Подключение ожидает подтверждения администратора',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
