'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { linkLeadToSellerAtomic } from '@/lib/services/lead-linking';

export interface AvailableSellerItem {
  seller_phone: string;
  seller_name: string;
  store: string;
  plan_name: string;
  plan_id: string | null;
  plan_price: number;
  balance: number;
  moderation: string;
  outlets_count: number;
  employees_count: number;
  registered_at: string | null;
  /** Текущее подключение продавца (046): лид привяжется к нему, состав не меняется */
  connection?: {
    connection_id: string;
    manager_id: string;
    manager_name: string | null;
    confirmation_status: 'pending' | 'confirmed';
  } | null;
}

export interface LinkLeadResult {
  success: boolean;
  connectionId?: string;
  connectionFeeAmount?: number;
  /** pending — подключение ждет подтверждения администратором */
  confirmationStatus?: 'pending' | 'confirmed';
  error?: string;
}

/**
 * Получение списка свободных продавцов для ручного связывания с лидом (право «leads.link_seller»)
 * ИНВАРИАНТ: Продавцы, чей телефон уже привязан к какому-либо лиду, исключаются из выборки
 */
export async function getAvailableSellersForMapping(
  searchQuery = ''
): Promise<{ sellers: AvailableSellerItem[]; error?: string }> {
  const ctx = await requireAuth().catch(() => null);
  if (!ctx) {
    return { sellers: [], error: 'Пользователь не аутентифицирован' };
  }
  if (!ctx.can('leads.link_seller')) {
    return { sellers: [], error: 'Недостаточно прав для связывания лида с продавцом' };
  }

  const admin = createAdminClient();

  // 1. Извлекаем все телефоны продавцов, которые уже привязаны к лидам
  const { data: linkedLeads, error: leadsError } = await admin
    .from('leads')
    .select('seller_phone')
    .not('seller_phone', 'is', null);

  if (leadsError) {
    console.error('Ошибка при проверке привязанных продавцов:', leadsError);
    return { sellers: [], error: leadsError.message };
  }

  const linkedPhones = (linkedLeads || [])
    .map((l) => l.seller_phone)
    .filter((phone): phone is string => Boolean(phone));

  // 2. Запрашиваем каталог планов для обогащения ценами
  const { data: plansData } = await admin
    .from('plans')
    .select('plan_id, plan_name, price');

  const plansMap = new Map<string, number>();
  if (plansData) {
    plansData.forEach((p) => {
      plansMap.set(p.plan_id, Number(p.price));
      plansMap.set(p.plan_name.toLowerCase(), Number(p.price));
    });
  }

  // 3. Выборка продавцов
  let query = admin.from('sellers').select('*');

  // Область данных модуля продавцов: без «sellers.view_all» — свои (основной или участник подключения)
  // и свободные одобренные; продавцы чужих подключений администратору видны, лид привяжется к их подключению
  if (!ctx.canViewAll('sellers')) {
    const { data: myParticipations } = await admin
      .from('connection_participants')
      .select('connection_id')
      .eq('user_id', ctx.profile.user_id);
    const participationIds = (myParticipations || []).map((p) => p.connection_id);
    let myPhones: string[] = [];
    if (participationIds.length > 0) {
      const { data: myConnections } = await admin
        .from('connections')
        .select('seller_phone')
        .in('connection_id', participationIds)
        .neq('confirmation_status', 'rejected');
      myPhones = (myConnections || []).map((c) => c.seller_phone).filter(Boolean);
    }
    const scopeParts = [`manager_id.eq.${ctx.profile.user_id}`, 'and(manager_id.is.null,moderation.eq.approved)'];
    if (myPhones.length > 0) scopeParts.push(`seller_phone.in.(${myPhones.map((p) => `"${p}"`).join(',')})`);
    query = query.or(scopeParts.join(','));
  }

  // Исключаем занятых продавцов
  if (linkedPhones.length > 0) {
    // В Supabase фильтр not in через .not('seller_phone', 'in', `(${linkedPhones.join(',')})`)
    query = query.not('seller_phone', 'in', `(${linkedPhones.map((p) => `"${p}"`).join(',')})`);
  }

  // Поиск по ФИО, магазину или телефону
  if (searchQuery.trim()) {
    const q = searchQuery.trim();
    query = query.or(
      `seller_phone.ilike.%${q}%,seller_name.ilike.%${q}%,store.ilike.%${q}%`
    );
  }

  query = query
    .order('registered_at', { ascending: false, nullsFirst: false })
    .limit(50);

  const { data: sellersData, error: sellersError } = await query;

  if (sellersError) {
    console.error('Ошибка при выборке свободных продавцов:', sellersError);
    return { sellers: [], error: sellersError.message };
  }

  // 4. Текущие подключения продавцов из выборки: лид привяжется к ним без изменения состава (046)
  const phones = (sellersData || []).map((s) => s.seller_phone).filter(Boolean);
  const connectionByPhone = new Map<string, NonNullable<AvailableSellerItem['connection']>>();
  if (phones.length > 0) {
    const { data: conns } = await admin
      .from('connections')
      .select('connection_id, seller_phone, manager_id, confirmation_status, assigned_at')
      .in('seller_phone', phones)
      .neq('confirmation_status', 'rejected')
      .order('assigned_at', { ascending: false });
    const managerIds = Array.from(new Set((conns || []).map((c) => c.manager_id).filter(Boolean)));
    const { data: managers } =
      managerIds.length > 0 ? await admin.from('users').select('user_id, full_name').in('user_id', managerIds) : { data: [] };
    const managerNames = new Map((managers || []).map((m) => [m.user_id, m.full_name]));
    for (const c of conns || []) {
      if (connectionByPhone.has(c.seller_phone)) continue;
      connectionByPhone.set(c.seller_phone, {
        connection_id: c.connection_id,
        manager_id: c.manager_id,
        manager_name: managerNames.get(c.manager_id) || null,
        confirmation_status: c.confirmation_status === 'confirmed' ? 'confirmed' : 'pending',
      });
    }
  }

  const enriched: AvailableSellerItem[] = (sellersData || []).map((s) => {
    let price = 2500; // Базовая цена по умолчанию
    if (s.plan_id && plansMap.has(s.plan_id)) {
      price = plansMap.get(s.plan_id)!;
    } else if (s.plan_name && plansMap.has(s.plan_name.toLowerCase())) {
      price = plansMap.get(s.plan_name.toLowerCase())!;
    }

    return {
      connection: connectionByPhone.get(s.seller_phone) || null,
      seller_phone: s.seller_phone,
      seller_name: s.seller_name,
      store: s.store,
      plan_name: s.plan_name,
      plan_id: s.plan_id,
      plan_price: price,
      balance: Number(s.balance) || 0,
      moderation: s.moderation,
      outlets_count: s.outlets_count,
      employees_count: s.employees_count,
      registered_at: s.registered_at,
    };
  });

  return { sellers: enriched };
}

/**
 * Получение персональной ставки комиссии консультанта за подключение.
 * Своя ставка доступна всегда; чужая — при праве «rates.manage» или «payouts.view_all».
 */
export async function getConsultantRate(consultantId: string): Promise<number> {
  const ctx = await requireAuth().catch(() => null);
  if (!ctx) return 30.0;

  const isSelf = consultantId === ctx.profile.user_id;
  if (!isSelf && !ctx.can('rates.manage') && !ctx.canViewAll('payouts')) {
    return 30.0; // Дефолтная ставка 30%
  }

  const { data } = await createAdminClient()
    .from('employee_rates')
    .select('connection_percent')
    .eq('user_id', consultantId)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data && data.connection_percent !== null) {
    return Number(data.connection_percent);
  }

  return 30.0; // Дефолтная ставка 30%
}

/**
 * Связывание лида с продавцом (046): лид — RPC link_lead_to_seller (продавец, «Подписан», ответственный);
 * подключение свободного продавца создает сервис (участники, сопровождение), подключенного — не меняется.
 */
export async function linkLeadToSeller(params: {
  leadId: string;
  sellerPhone: string;
  managerId?: string;
  participants?: string[];
  maintenance?: { month_index: number; user_ids: string[] }[];
}): Promise<LinkLeadResult> {
  try {
    const ctx = await requireAuth();

    if (!ctx.can('leads.link_seller')) {
      return { success: false, error: 'Недостаточно прав для связывания лида с продавцом' };
    }

    const result = await linkLeadToSellerAtomic(ctx, { ...params, via: 'lead' });
    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath('/leads');
    revalidatePath('/sellers');
    revalidatePath('/connections');
    revalidatePath('/payouts');

    return {
      success: true,
      connectionId: result.connectionId,
      connectionFeeAmount: result.connectionFeeAmount,
      confirmationStatus: result.confirmationStatus,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка связывания лида с продавцом' };
  }
}
