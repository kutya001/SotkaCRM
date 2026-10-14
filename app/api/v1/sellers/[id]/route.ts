import { NextRequest } from 'next/server';
import { requireAuth, requirePermission, PermissionError } from '@/lib/auth/check-role';
import { PERMISSION_LABELS } from '@/lib/auth/permissions-catalog';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignSellerManager } from '@/app/sellers/actions';
import { findSellerByKey, isSellerInScope } from '@/lib/services/sellers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const ctx = await requirePermission('sellers.menu');
    const supabase = createAdminClient();

    const { data: seller, error } = await supabase
      .from('sellers')
      .select('*')
      .or(`seller_phone.eq.${decodedId},organization_id.eq.${decodedId}`)
      .single();

    if (error || !seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }

    // Область видимости: без «sellers.view_all» — только свои и свободные одобренные
    if (!isSellerInScope(ctx, seller)) {
      return apiError('Продавец не назначен вам или находится на модерации', 'FORBIDDEN', 403);
    }

    return apiSuccess(seller);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const ctx = await requireAuth();
    const body = await req.json();

    const allowedFields = [
      'seller_name',
      'store',
      'plan_id',
      'plan_name',
      'moderation',
      'is_active',
      'manager_id',
      'brands',
      'outlets_count',
      'employees_count',
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (field !== 'manager_id' && body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    const changesManager = body.manager_id !== undefined;
    const changesFields = Object.keys(updates).length > 0;

    // Смена консультанта — право «sellers.assign»; остальные поля карточки — «sellers.edit»
    if (changesManager && !ctx.can('sellers.assign')) {
      throw new PermissionError(`Недостаточно прав. Требуется: ${PERMISSION_LABELS['sellers.assign']}.`);
    }
    if ((changesFields || !changesManager) && !ctx.can('sellers.edit')) {
      throw new PermissionError(`Недостаточно прав. Требуется: ${PERMISSION_LABELS['sellers.edit']}.`);
    }

    const supabase = createAdminClient();

    // Запись должна быть в области видимости сотрудника
    const { data: current, error: currentErr } = await supabase
      .from('sellers')
      .select('*')
      .or(`seller_phone.eq.${decodedId},organization_id.eq.${decodedId}`)
      .single();

    if (currentErr || !current) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }
    if (!isSellerInScope(ctx, current)) {
      return apiError('Продавец вне вашей области видимости', 'FORBIDDEN', 403);
    }

    if (changesManager) {
      const assignRes = await assignSellerManager(current.seller_phone, body.manager_id);
      if (!assignRes.success) {
        return apiError(assignRes.error || 'Ошибка назначения консультанта', 'ASSIGN_FAILED', 400);
      }
    }

    if (changesFields) {
      const { data: updated, error } = await supabase
        .from('sellers')
        .update(updates as any)
        .eq('seller_phone', current.seller_phone)
        .select('*')
        .single();

      if (error) throw error;
      return apiSuccess(updated);
    }

    const { data: refreshed } = await supabase
      .from('sellers')
      .select('*')
      .eq('seller_phone', current.seller_phone)
      .single();

    return apiSuccess(refreshed ?? current);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    await requirePermission('sellers.delete');
    const supabase = createAdminClient();

    // 1. Поиск продавца для определения seller_phone
    const seller = await findSellerByKey(supabase, id, ['seller_phone'] as const);
    if (!seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }
    const targetPhone = seller.seller_phone;

    // 2. Отвязываем лид, если был привязан
    await supabase
      .from('leads')
      .update({ seller_phone: null, linked_at: null, status: 'Назначен' } as any)
      .eq('seller_phone', targetPhone);

    // 3. Удаляем связанные подключения
    await supabase
      .from('connections')
      .delete()
      .eq('seller_phone', targetPhone);

    // 4. Удаляем продавца
    const { error } = await supabase
      .from('sellers')
      .delete()
      .eq('seller_phone', targetPhone);

    if (error) throw error;

    return apiSuccess({ success: true, deleted_id: decodedId, seller_phone: targetPhone });
  } catch (err) {
    return handleApiError(err);
  }
}
