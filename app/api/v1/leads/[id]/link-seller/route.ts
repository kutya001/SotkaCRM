import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { linkLeadToSellerAtomic, unlinkLeadFromSeller } from '@/lib/services/lead-linking';
import { PG_UUID_REGEX } from '@/lib/validations';
import { createAdminClient } from '@/lib/supabase/admin';
import { isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';

const LinkSchema = z.object({
  seller_phone: z.string().min(6, 'Номер телефона продавца обязателен'),
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
  /** Совместимость: желаемый консультант (учитывается при праве «sellers.assign») */
  manager_id: z.string().regex(PG_UUID_REGEX).nullable().optional(),
});

/**
 * POST /api/v1/leads/[id]/link-seller — привязка лида к продавцу (046).
 * Свободный продавец: создается подключение с участниками и сопровождением (как «Подключить…»);
 * подключенный продавец: лид только привязывается к существующему подключению.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.link_seller');
    const body = await req.json().catch(() => ({}));
    const parsed = LinkSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const result = await linkLeadToSellerAtomic(ctx, {
      leadId: id,
      sellerPhone: parsed.data.seller_phone,
      participants: parsed.data.participants,
      maintenance: parsed.data.maintenance,
      managerId: parsed.data.manager_id,
      via: 'lead',
      appOrigin: req.nextUrl.origin,
    });

    if (!result.success) {
      return apiError(result.error || 'Ошибка связывания лида с продавцом', 'LINK_FAILED', 400);
    }

    return apiSuccess({
      success: true,
      lead_id: id,
      seller_phone: parsed.data.seller_phone,
      connection_id: result.connectionId,
      connection_fee_amount: result.connectionFeeAmount,
      confirmation_status: result.confirmationStatus,
      mode: result.mode,
      manager_id: result.managerId,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE — отвязка (то же, что POST /unlink-seller) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.unlink_seller');
    const { data: lead } = await createAdminClient()
      .from('leads')
      .select('lead_id, seller_phone, created_by, assigned_to')
      .eq('lead_id', id)
      .maybeSingle();
    if (!lead) return apiError('Лид не найден', 'NOT_FOUND', 404);
    if (!isLeadInScope(leadActorFrom(ctx), lead)) return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    if (!lead.seller_phone) return apiError('Лид не связан с продавцом', 'NOT_LINKED', 400);

    const res = await unlinkLeadFromSeller(id);
    if (!res.success) return apiError(res.error || 'Ошибка отвязки', 'UNLINK_FAILED', 400);
    return apiSuccess({ success: true, lead_id: id, seller_phone: res.sellerPhone, new_status: 'Назначен', connection_deleted: res.connectionDeleted });
  } catch (err) {
    return handleApiError(err);
  }
}
