import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSellerInScope } from '@/lib/services/sellers';
import { linkLeadToSellerAtomic } from '@/lib/services/lead-linking';
import { PG_UUID_REGEX } from '@/lib/validations';

const LinkSchema = z.object({
  lead_id: z.string().regex(PG_UUID_REGEX, 'Параметр lead_id обязателен'),
  /** Состав нового подключения (первый — основной); без права «sellers.assign» основным должен быть ответственный за лид */
  participants: z.array(z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника')).max(3).optional(),
  maintenance: z
    .array(
      z.object({
        month_index: z.number().int().min(1).max(24),
        user_ids: z.array(z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника')).max(3),
      })
    )
    .max(24)
    .optional(),
});

/**
 * POST /api/v1/sellers/[id]/link-lead — привязка лида к продавцу со стороны продавца (046).
 * Свободный продавец: создается подключение (участники, сопровождение); подключенный —
 * лид привязывается к существующему подключению (администратор или участник подключения).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sellerPhone = decodeURIComponent(id);
    const ctx = await requirePermission('sellers.link_lead');
    const body = await req.json().catch(() => ({}));
    const parsed = LinkSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const { data: sellerCheck, error: sellerCheckErr } = await createAdminClient()
      .from('sellers')
      .select('seller_phone, manager_id, moderation')
      .eq('seller_phone', sellerPhone)
      .maybeSingle();
    if (sellerCheckErr) throw sellerCheckErr;
    if (!sellerCheck) return apiError('Продавец не найден в базе данных Sotka', 'NOT_FOUND', 404);
    if (!isSellerInScope(ctx, sellerCheck)) return apiError('Продавец вне вашей области видимости', 'FORBIDDEN', 403);

    const res = await linkLeadToSellerAtomic(ctx, {
      leadId: parsed.data.lead_id,
      sellerPhone,
      participants: parsed.data.participants,
      maintenance: parsed.data.maintenance,
      via: 'seller',
      appOrigin: req.nextUrl.origin,
    });
    if (!res.success) {
      return apiError(res.error || 'Ошибка при связывании продавца с лидом', 'LINK_FAILED', 400);
    }

    return apiSuccess({
      success: true,
      seller_phone: sellerPhone,
      lead_id: parsed.data.lead_id,
      connection_id: res.connectionId,
      connection_fee_amount: res.connectionFeeAmount,
      confirmation_status: res.confirmationStatus,
      mode: res.mode,
      manager_id: res.managerId,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
