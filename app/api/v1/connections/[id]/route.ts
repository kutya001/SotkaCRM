import { NextRequest } from 'next/server';
import { requireAuth, requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { profile, supabase } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к подключениям', 'FORBIDDEN', 403);
    }

    let query = supabase
      .from('connections')
      .select(`
        *,
        seller:sellers(seller_name, store, plan_id, plan_expires_at, is_active),
        manager:users!connections_manager_id_fkey(user_id, full_name, role)
      `)
      .eq('connection_id', id);

    if (profile.role === 'consultant') {
      query = query.eq('manager_id', profile.user_id);
    }

    const { data: conn, error } = await query.single();
    if (error || !conn) {
      return apiError('Подключение не найдено', 'NOT_FOUND', 404);
    }

    return apiSuccess(conn);
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
    const { supabase } = await requireRoles(['admin', 'supervisor']);
    const body = await req.json();

    const allowed = [
      'status',
      'client_status',
      'manager_id',
      'plan_id',
      'plan_price',
      'connection_fee_percent',
      'connection_fee_amount',
      'connection_fee',
      'maintenance_fee_monthly',
      'maintenance_months_total',
      'maintenance_month_start',
      'accrual_month',
      'maintenance_months_limit',
      'maintenance_months_accrued',
    ];

    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    const { data: updated, error } = await supabase
      .from('connections')
      .update(updates as any)
      .eq('connection_id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return apiError('Подключение не найдено или не удалось обновить', 'NOT_FOUND', 404);
    }

    return apiSuccess(updated);
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
    const { supabase } = await requireRoles(['admin', 'supervisor']);

    const { error } = await supabase
      .from('connections')
      .delete()
      .eq('connection_id', id);

    if (error) throw error;

    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
