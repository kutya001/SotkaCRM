import { NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { findSellerByKey } from '@/lib/services/sellers';
import { assignSellerToManager } from '@/lib/services/connections';

/**
 * «Взять себе»: консультант становится куратором свободного одобренного продавца.
 * Подключение создается в статусе pending — начисление за подключение произойдет
 * только после подтверждения администратором (миграция 037).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, profile } = await requireRoles(['consultant']);

    const seller = await findSellerByKey(supabase, id, ['seller_phone', 'manager_id', 'moderation'] as const);
    if (!seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }
    if (seller.manager_id) {
      return apiError(
        seller.manager_id === profile.user_id ? 'Этот продавец уже закреплен за вами' : 'У продавца уже есть куратор',
        'SELLER_ALREADY_TAKEN',
        409
      );
    }

    const res = await assignSellerToManager({
      sellerPhone: seller.seller_phone,
      managerId: profile.user_id,
      actor: profile,
      confirmation: 'pending',
      expectUnassigned: true,
      requireApproved: true,
    });

    if (!res.success) {
      return apiError(res.error, res.code, res.status);
    }

    return apiSuccess({
      success: true,
      seller_phone: seller.seller_phone,
      manager_id: profile.user_id,
      connection_id: res.connectionId,
      confirmation_status: res.confirmationStatus,
      message: 'Продавец закреплен за вами. Подключение ожидает подтверждения администратора',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
