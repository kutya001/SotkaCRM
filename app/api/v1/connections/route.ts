import { NextRequest } from 'next/server';
import { requireAuth, requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к подключениям', 'FORBIDDEN', 403);
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search');
    const accrualMonth = searchParams.get('accrualMonth');
    const clientStatus = searchParams.get('clientStatus');
    const managerId = searchParams.get('managerId');
    const sortBy = searchParams.get('sortBy') || 'assigned_at';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    let query = supabase.from('connections').select('*', { count: 'exact' });

    if (profile.role === 'consultant') {
      query = query.eq('manager_id', profile.user_id);
    } else if (managerId && managerId !== 'all') {
      query = query.eq('manager_id', managerId);
    }

    if (accrualMonth && accrualMonth !== 'all') {
      query = query.eq('accrual_month', accrualMonth);
    }

    if (clientStatus && clientStatus !== 'all') {
      query = query.eq('client_status', clientStatus as any);
    }

    if (search && search.trim()) {
      const q = search.trim();
      query = query.or(
        `seller_phone.ilike.%${q}%,seller_name.ilike.%${q}%,store.ilike.%${q}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false }).range(from, to);

    const { data: connections, count, error } = await query;
    if (error) throw error;

    // Обогащаем данными менеджеров
    const managerIds = Array.from(
      new Set((connections || []).map((c) => c.manager_id).filter(Boolean))
    );

    let managersMap = new Map();
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from('users')
        .select('user_id, full_name, role, login, color')
        .in('user_id', managerIds);

      if (managers) {
        managers.forEach((m) => managersMap.set(m.user_id, m));
      }
    }

    const enriched = (connections || []).map((c) => ({
      ...c,
      manager_user: c.manager_id ? managersMap.get(c.manager_id) || null : null,
    }));

    return apiSuccess({
      items: enriched,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, profile } = await requireRoles(['admin', 'supervisor']);
    const body = await req.json();

    const sellerPhone = (body.seller_phone || '').replace(/\D/g, '');
    if (!sellerPhone) {
      return apiError('Номер телефона продавца обязателен', 'MISSING_PHONE', 400);
    }

    const nowIso = new Date().toISOString();
    const currentMonth = body.accrual_month || nowIso.substring(0, 7);
    const planPrice = Number(body.plan_price) || 2500;
    const feePercent = Number(body.connection_fee_percent) || 30;
    const feeAmount = Math.round(((planPrice * feePercent) / 100) * 100) / 100;

    const insertPayload = {
      seller_phone: sellerPhone,
      seller_name: (body.seller_name || 'Без имени').trim(),
      store: (body.store || 'Без названия').trim(),
      manager_id: body.manager_id || profile.user_id,
      assigned_by: profile.user_id,
      assigned_at: nowIso,
      status: body.status || 'подключен',
      plan_id: body.plan_id || null,
      plan_price: planPrice,
      connection_fee_percent: feePercent,
      connection_fee_amount: feeAmount,
      accrual_month: currentMonth,
      client_status: body.client_status || 'новый',
      maintenance_months_limit: Number(body.maintenance_months_limit) || 3,
      maintenance_months_accrued: 0,
    };

    const { data: newConn, error } = await supabase
      .from('connections')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) throw error;

    return apiSuccess(newConn, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
