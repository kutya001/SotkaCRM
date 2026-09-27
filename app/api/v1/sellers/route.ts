import { NextRequest } from 'next/server';
import { requireAuth, requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import type { SellerModerationStatus } from '@/types/database.types';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к базе продавцов', 'FORBIDDEN', 403);
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || '';
    const moderation = searchParams.get('moderation');
    const isActive = searchParams.get('isActive');
    const managerId = searchParams.get('managerId');
    const sortBy = searchParams.get('sortBy') || 'synced_at';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    let query = supabase.from('sellers').select('*', { count: 'exact' });

    // Изоляция: консультант видит только не назначенных либо своих approved продавцов
    if (profile.role === 'consultant') {
      query = query.eq('moderation', 'approved');
      if (managerId === 'unassigned') {
        query = query.is('manager_id', null);
      } else if (managerId === profile.user_id || managerId === 'my') {
        query = query.eq('manager_id', profile.user_id);
      } else {
        query = query.or(`manager_id.is.null,manager_id.eq.${profile.user_id}`);
      }
    } else {
      if (moderation && moderation !== 'all') {
        query = query.eq('moderation', moderation as SellerModerationStatus);
      }
      if (managerId && managerId !== 'all') {
        if (managerId === 'unassigned') {
          query = query.is('manager_id', null);
        } else if (managerId === 'my') {
          query = query.eq('manager_id', profile.user_id);
        } else {
          query = query.eq('manager_id', managerId);
        }
      }
    }

    if (search.trim()) {
      const q = search.trim();
      query = query.or(
        `seller_phone.ilike.%${q}%,seller_name.ilike.%${q}%,store.ilike.%${q}%`
      );
    }

    if (isActive && isActive !== 'all') {
      query = query.eq('is_active', isActive === 'true');
    }

    const validSortColumns = ['balance', 'registered_at', 'synced_at', 'store', 'seller_name', 'outlets_count'];
    if (sortBy && validSortColumns.includes(sortBy) && sortBy !== 'registered_at') {
      query = query.order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false });
    } else {
      // Детерминированный порядок: продавцы по дате регистрации всегда на своем месте
      query = query
        .order('registered_at', { ascending: sortOrder === 'asc', nullsFirst: false })
        .order('created_at', { ascending: false });
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: sellersData, count, error } = await query;
    if (error) throw error;

    // Обогащаем данными кураторов и связанных лидов
    const managerIds = Array.from(
      new Set((sellersData || []).map((s) => s.manager_id).filter((id): id is string => Boolean(id)))
    );
    const sellerPhones = (sellersData || []).map((s) => s.seller_phone);

    const [managersRes, leadsRes] = await Promise.all([
      managerIds.length > 0
        ? supabase.from('users').select('user_id, full_name, role, login, color').in('user_id', managerIds)
        : Promise.resolve({ data: null }),
      sellerPhones.length > 0
        ? supabase.from('leads').select('lead_id, client_name, status, created_at, seller_phone').in('seller_phone', sellerPhones)
        : Promise.resolve({ data: null }),
    ]);

    const managersMap = new Map();
    if (managersRes.data) {
      managersRes.data.forEach((m) => managersMap.set(m.user_id, m));
    }

    const leadsMap = new Map();
    if (leadsRes.data) {
      leadsRes.data.forEach((l) => {
        if (l.seller_phone) leadsMap.set(l.seller_phone, l);
      });
    }

    const enriched = (sellersData || []).map((seller) => ({
      ...seller,
      manager_user: seller.manager_id ? managersMap.get(seller.manager_id) || null : null,
      linked_lead: leadsMap.get(seller.seller_phone) || null,
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
    const { supabase } = await requireRoles(['admin', 'supervisor']);
    const body = await req.json();

    const cleanPhone = (body.seller_phone || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 6) {
      return apiError('Укажите корректный номер телефона продавца', 'INVALID_PHONE', 422);
    }

    const insertPayload = {
      seller_phone: cleanPhone,
      seller_name: (body.seller_name || 'Без имени').trim(),
      store: (body.store || 'Без названия').trim(),
      balance: Number(body.balance) || 0,
      plan_name: body.plan_name || 'Базовый',
      plan_id: body.plan_id || null,
      moderation: body.moderation || 'pending',
      is_active: body.is_active ?? true,
      outlets_count: Number(body.outlets_count) || 1,
      employees_count: Number(body.employees_count) || 1,
      brands: body.brands || null,
      manager_id: body.manager_id || null,
      synced_at: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    };

    const { data: newSeller, error } = await supabase
      .from('sellers')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) throw error;

    return apiSuccess(newSeller, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
