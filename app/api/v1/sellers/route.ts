import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SellerModerationStatus } from '@/types/database.types';
import { applySellersOrder, sellersOwnScopeFilter } from '@/lib/services/sellers';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('sellers.menu');
    const { profile } = ctx;
    // Права роли могут превышать базовую RLS-роль: сервисный клиент + явный фильтр области видимости
    const supabase = createAdminClient();
    const viewAll = ctx.canViewAll('sellers');

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || '';
    const moderation = searchParams.get('moderation');
    const isActive = searchParams.get('isActive');
    const managerId = searchParams.get('managerId');
    const sortBy = searchParams.get('sortBy') || 'registered_at';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    let query = supabase.from('sellers').select('*', { count: 'exact' });

    // Изоляция без «sellers.view_all»: только свои продавцы либо свободные одобренные
    if (!viewAll) {
      if (managerId === 'unassigned') {
        query = query.is('manager_id', null).eq('moderation', 'approved');
      } else if (managerId === profile.user_id || managerId === 'my') {
        query = query.eq('manager_id', profile.user_id);
      } else {
        query = query.or(sellersOwnScopeFilter(profile.user_id));
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

    query = applySellersOrder(query, sortBy, sortOrder);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: sellersData, count, error } = await query;
    if (error) throw error;

    // Обогащаем данными консультантов и связанных лидов
    const managerIds = Array.from(
      new Set((sellersData || []).map((s) => s.manager_id).filter((id): id is string => Boolean(id)))
    );
    const sellerPhones = (sellersData || []).map((s) => s.seller_phone);

    const [managersRes, leadsRes, connectionsRes] = await Promise.all([
      managerIds.length > 0
        ? supabase.from('users').select('user_id, full_name, role, login, color').in('user_id', managerIds)
        : Promise.resolve({ data: null }),
      sellerPhones.length > 0
        ? supabase.from('leads').select('lead_id, client_name, status, created_at, seller_phone').in('seller_phone', sellerPhones)
        : Promise.resolve({ data: null }),
      sellerPhones.length > 0
        ? supabase
            .from('connections')
            .select('connection_id, seller_phone, manager_id, confirmation_status, rejection_reason, assigned_at')
            .in('seller_phone', sellerPhones)
            .order('assigned_at', { ascending: false })
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

    // Текущее подключение продавца (самое свежее) — статус подтверждения и участники (043)
    type ParticipantRef = { user_id: string; full_name: string; role: string; login: string; color: string | null };
    const connectionsMap = new Map<
      string,
      { connection_id: string; manager_id: string; confirmation_status: string; rejection_reason: string | null; participants: ParticipantRef[] }
    >();
    if (connectionsRes.data) {
      for (const c of connectionsRes.data as any[]) {
        if (!connectionsMap.has(c.seller_phone)) {
          connectionsMap.set(c.seller_phone, {
            connection_id: c.connection_id,
            manager_id: c.manager_id,
            confirmation_status: c.confirmation_status,
            rejection_reason: c.rejection_reason,
            participants: [],
          });
        }
      }
    }
    const connectionIds = Array.from(connectionsMap.values()).map((c) => c.connection_id);
    if (connectionIds.length > 0) {
      const { data: partRows } = await supabase
        .from('connection_participants')
        .select('connection_id, user_id, added_at')
        .in('connection_id', connectionIds)
        .order('added_at', { ascending: true });
      const extraIds = Array.from(new Set((partRows || []).map((r) => r.user_id).filter((id) => !managersMap.has(id))));
      if (extraIds.length > 0) {
        const { data: extraUsers } = await supabase.from('users').select('user_id, full_name, role, login, color').in('user_id', extraIds);
        (extraUsers || []).forEach((m) => managersMap.set(m.user_id, m));
      }
      const byConn = new Map<string, string[]>();
      for (const r of partRows || []) {
        const arr = byConn.get(r.connection_id) || [];
        arr.push(r.user_id);
        byConn.set(r.connection_id, arr);
      }
      for (const conn of connectionsMap.values()) {
        const ids = [conn.manager_id, ...(byConn.get(conn.connection_id) || []).filter((id) => id !== conn.manager_id)].filter(Boolean);
        conn.participants = ids.map((id) => {
          const u = managersMap.get(id);
          return u ? { ...u, color: u.color ?? null } : { user_id: id, full_name: 'Сотрудник', role: '', login: '', color: null };
        });
      }
    }

    const enriched = (sellersData || []).map((seller) => ({
      ...seller,
      manager_user: seller.manager_id ? managersMap.get(seller.manager_id) || null : null,
      linked_lead: leadsMap.get(seller.seller_phone) || null,
      connection: connectionsMap.get(seller.seller_phone) || null,
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
    await requirePermission('sellers.create');
    const supabase = createAdminClient();
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
