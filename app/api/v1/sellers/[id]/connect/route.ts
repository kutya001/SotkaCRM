import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSellerByKey } from '@/lib/services/sellers';
import { createSellerConnection } from '@/lib/services/connections';
import { PG_UUID_REGEX } from '@/lib/validations';

const uuid = z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника');

const ConnectSchema = z.object({
  participants: z.array(uuid).min(1).max(3),
  maintenance: z
    .array(z.object({ month_index: z.number().int().min(1).max(24), user_ids: z.array(uuid).max(3) }))
    .max(24)
    .optional(),
});

/**
 * POST /api/v1/sellers/[id]/connect — подключить продавца (право «sellers.take»):
 * создающий сотрудник — обязательный участник и консультант продавца, можно добавить до двух коллег
 * и сопровождающих по месяцам. С правом «connections.confirm» подключение подтверждается сразу,
 * иначе ожидает подтверждения администратора.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('sellers.take');
    const { profile } = ctx;
    const body = await req.json().catch(() => ({}));
    const parsed = ConnectSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }
    if (!parsed.data.participants.includes(profile.user_id)) {
      return apiError('Вы должны быть участником создаваемого подключения', 'ACTOR_NOT_PARTICIPANT', 422);
    }

    const supabase = createAdminClient();
    const seller = await findSellerByKey(supabase, id, ['seller_phone', 'manager_id', 'moderation'] as const);
    if (!seller) return apiError('Продавец не найден', 'NOT_FOUND', 404);
    if (seller.manager_id) {
      return apiError(
        seller.manager_id === profile.user_id ? 'Этот продавец уже закреплен за вами' : 'У продавца уже есть консультант',
        'SELLER_ALREADY_TAKEN',
        409
      );
    }

    const canConfirm = ctx.can('connections.confirm');
    const res = await createSellerConnection({
      sellerPhone: seller.seller_phone,
      participants: parsed.data.participants,
      maintenance: parsed.data.maintenance,
      actor: profile,
      canConfirm,
      appOrigin: req.nextUrl.origin,
    });
    if (!res.success) return apiError(res.error, res.code, res.status);

    return apiSuccess({
      success: true,
      seller_phone: seller.seller_phone,
      connection_id: res.connectionId,
      confirmation_status: res.confirmationStatus,
      skipped: res.skipped,
      message: canConfirm
        ? 'Продавец подключен. Подключение подтверждено'
        : 'Продавец подключен. Подключение ожидает подтверждения администратора',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
