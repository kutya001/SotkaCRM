import { NextRequest } from 'next/server';
import { requireAuth, requireRoles, requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { assignSellerManager } from '@/app/sellers/actions';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const { supabase, profile } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к продавцам', 'FORBIDDEN', 403);
    }

    const { data: seller, error } = await supabase
      .from('sellers')
      .select('*')
      .or(`seller_phone.eq.${decodedId},organization_id.eq.${decodedId}`)
      .single();

    if (error || !seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }

    if (profile.role === 'consultant') {
      if (seller.moderation !== 'approved' || seller.manager_id !== profile.user_id) {
        return apiError('Продавец не назначен вам или находится на модерации', 'FORBIDDEN', 403);
      }
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
    const { supabase } = await requireRoles(['admin', 'supervisor']);
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

    if (body.manager_id !== undefined) {
      const assignRes = await assignSellerManager(decodedId, body.manager_id);
      if (!assignRes.success) {
        return apiError(assignRes.error || 'Ошибка назначения куратора', 'ASSIGN_FAILED', 400);
      }
    }

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (field !== 'manager_id' && body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length > 0) {
      const { data: updated, error } = await supabase
        .from('sellers')
        .update(updates as any)
        .or(`seller_phone.eq.${decodedId},organization_id.eq.${decodedId}`)
        .select('*')
        .single();

      if (error) throw error;
      return apiSuccess(updated);
    }

    const { data: current } = await supabase
      .from('sellers')
      .select('*')
      .or(`seller_phone.eq.${decodedId},organization_id.eq.${decodedId}`)
      .single();

    return apiSuccess(current);
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
    const { supabase } = await requireAdmin();

    const { error } = await supabase
      .from('sellers')
      .delete()
      .or(`seller_phone.eq.${decodedId},organization_id.eq.${decodedId}`);

    if (error) throw error;

    return apiSuccess({ success: true, deleted_id: decodedId });
  } catch (err) {
    return handleApiError(err);
  }
}
