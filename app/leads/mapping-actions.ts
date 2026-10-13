'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/check-role';
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
 * Получение списка свободных продавцов для ручного связывания с лидом
 * ИНВАРИАНТ: Продавцы, чей телефон уже привязан к какому-либо лиду, исключаются из выборки
 */
export async function getAvailableSellersForMapping(
  searchQuery = ''
): Promise<{ sellers: AvailableSellerItem[]; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { sellers: [], error: 'Пользователь не аутентифицирован' };
  }

  // 1. Извлекаем все телефоны продавцов, которые уже привязаны к лидам
  const { data: linkedLeads, error: leadsError } = await supabase
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
  const { data: plansData } = await supabase
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
  let query = supabase.from('sellers').select('*');

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

  const enriched: AvailableSellerItem[] = (sellersData || []).map((s) => {
    let price = 2500; // Базовая цена по умолчанию
    if (s.plan_id && plansMap.has(s.plan_id)) {
      price = plansMap.get(s.plan_id)!;
    } else if (s.plan_name && plansMap.has(s.plan_name.toLowerCase())) {
      price = plansMap.get(s.plan_name.toLowerCase())!;
    }

    return {
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
 * Получение персональной ставки комиссии консультанта за подключение
 */
export async function getConsultantRate(consultantId: string): Promise<number> {
  const supabase = await createClient();

  const { data } = await supabase
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
 * Атомарная операция связывания лида с продавцом (RPC link_lead_to_seller):
 * 1. leads: seller_phone = selectedPhone, status = 'Подписан', linked_at = now()
 * 2. sellers: manager_id = consultantId
 * 3. connections: создание записи закрепления с расчетом комиссии
 */
export async function linkLeadToSeller(params: {
  leadId: string;
  sellerPhone: string;
  managerId?: string;
}): Promise<LinkLeadResult> {
  try {
    const ctx = await requireAuth();

    if (ctx.profile.role === 'smm' || ctx.profile.role === 'supervisor') {
      return { success: false, error: 'Связывать лид с продавцом может администратор или консультант' };
    }

    const result = await linkLeadToSellerAtomic(ctx, params);
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
