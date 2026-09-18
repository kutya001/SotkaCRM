'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Database, UserRole } from '@/types/database.types';

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
 * Атомарная операция связывания лида с продавцом:
 * 1. leads: seller_phone = selectedPhone, status = 'Подписан', linked_at = now()
 * 2. sellers: manager_id = consultantId
 * 3. connections: создание записи закрепления с расчетом комиссии
 */
export async function linkLeadToSeller(params: {
  leadId: string;
  sellerPhone: string;
  managerId?: string;
}): Promise<LinkLeadResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Пользователь не аутентифицирован' };
  }

  // Проверяем роль текущего пользователя (RBAC)
  const { data: currentProfile } = await supabase
    .from('users')
    .select('user_id, role, full_name')
    .eq('auth_id', user.id)
    .single();

  if (!currentProfile) {
    return { success: false, error: 'Профиль пользователя не найден' };
  }

  if (currentProfile.role === 'smm') {
    return { success: false, error: 'Роль SMM не имеет прав на связывание лида с продавцом' };
  }

  // 1. Проверяем лид
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('lead_id', params.leadId)
    .single();

  if (leadError || !lead) {
    return { success: false, error: 'Лид не найден в системе' };
  }

  if (lead.seller_phone) {
    return {
      success: false,
      error: `Этот лид уже связан с продавцом +${lead.seller_phone}`,
    };
  }

  if (lead.status === 'Подписан') {
    return { success: false, error: 'Лид уже имеет статус «Подписан»' };
  }

  if (lead.status === 'Отмена') {
    return { success: false, error: 'Нельзя привязать отмененный лид' };
  }

  // 2. Проверяем продавца на коллизию (не занят ли он другим лидом)
  const { data: collisionLead } = await supabase
    .from('leads')
    .select('lead_id, client_name')
    .eq('seller_phone', params.sellerPhone)
    .maybeSingle();

  if (collisionLead) {
    return {
      success: false,
      error: `Продавец +${params.sellerPhone} уже привязан к другому лиду («${collisionLead.client_name}»)`,
    };
  }

  // 3. Запрашиваем продавца
  const { data: seller, error: sellerError } = await supabase
    .from('sellers')
    .select('*')
    .eq('seller_phone', params.sellerPhone)
    .single();

  if (sellerError || !seller) {
    return { success: false, error: 'Продавец не найден в базе данных Sotka' };
  }

  // 4. Определяем ответственного менеджера / консультанта
  const responsibleManagerId =
    lead.assigned_to || params.managerId || currentProfile.user_id;

  // 5. Определяем стоимость тарифа
  let planPrice = 2500;
  if (seller.plan_id) {
    const { data: planData } = await supabase
      .from('plans')
      .select('price')
      .eq('plan_id', seller.plan_id)
      .maybeSingle();
    if (planData) planPrice = Number(planData.price);
  }

  // 6. Получаем ставку комиссии
  const connectionPercent = await getConsultantRate(responsibleManagerId);
  const connectionFeeAmount = Math.round(((planPrice * connectionPercent) / 100) * 100) / 100;
  const currentMonth = new Date().toISOString().substring(0, 7); // 'YYYY-MM'

  // 7. Обновляем лид
  const nowIso = new Date().toISOString();
  const { error: updateLeadError } = await supabase
    .from('leads')
    .update({
      seller_phone: params.sellerPhone,
      status: 'Подписан',
      linked_at: nowIso,
      assigned_to: responsibleManagerId,
      updated_at: nowIso,
    })
    .eq('lead_id', params.leadId);

  if (updateLeadError) {
    console.error('Ошибка обновления лида при связывании:', updateLeadError);
    return { success: false, error: updateLeadError.message };
  }

  // 8. Обновляем продавца: назначаем куратора manager_id
  await supabase
    .from('sellers')
    .update({ manager_id: responsibleManagerId })
    .eq('seller_phone', params.sellerPhone);

  // 9. Создаем запись в connections
  const { data: connectionData, error: connectionError } = await supabase
    .from('connections')
    .insert({
      seller_phone: params.sellerPhone,
      seller_name: seller.seller_name || lead.client_name,
      store: seller.store || 'Без названия',
      manager_id: responsibleManagerId,
      assigned_by: currentProfile.user_id,
      assigned_at: nowIso,
      status: 'подключен',
      plan_id: seller.plan_id,
      plan_price: planPrice,
      connection_fee_percent: connectionPercent,
      connection_fee_amount: connectionFeeAmount,
      accrual_month: currentMonth,
      client_status: 'новый',
      maintenance_months_limit: 3,
      maintenance_months_accrued: 0,
    })
    .select('connection_id')
    .single();

  if (connectionError) {
    console.error('Ошибка создания записи в connections:', connectionError);
    return { success: false, error: connectionError.message };
  }

  revalidatePath('/leads');
  revalidatePath('/sellers');
  revalidatePath('/connections');

  return {
    success: true,
    connectionId: connectionData?.connection_id,
  };
}
