'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuth, requirePermission, type AuthContext } from '@/lib/auth/check-role';
import type { Database, UserRole, SellerModerationStatus, ConnectionConfirmationStatus } from '@/types/database.types';
import {
  authenticateSotkaAdmin,
  fetchSellersOverview,
  fetchSellerDetail,
  logoutSotkaSession,
} from '@/lib/services/sotka-api';
import { linkLeadToSellerAtomic } from '@/lib/services/lead-linking';
import { assignSellerToManager } from '@/lib/services/connections';
import { applySellersOrder, findSellerByKey, isSellerInScope, sellersOwnScopeFilter } from '@/lib/services/sellers';
import { refreshSellersHqTotals } from '@/lib/services/hq-totals';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import {
  normalizeSotkaSeller,
  resolveSotkaPlan,
  parseDateToISO,
  extractSellerDetailRegisteredAt,
  type NormalizedSotkaSeller,
  type SotkaSellerDetail,
  type SotkaSellerOverviewItem,
  SotkaAuthError,
} from '@/lib/sotka';

/** Бюджет времени синхронизации (serverless-функция Vercel) */
const SYNC_TIME_BUDGET_MS = 20_000;
/** Сколько детальных карточек Sotka запрашивать за один запуск для дозаполнения даты регистрации */
const DETAIL_BACKFILL_LIMIT = 40;
const DETAIL_BACKFILL_CONCURRENCY = 5;
/** Обновление итогов транзакций Sotka HQ: сначала давно не обновлявшиеся, в пределах бюджета времени */
const HQ_TOTALS_REFRESH_LIMIT = 120;

export interface LinkedLeadInfo {
  lead_id: string;
  client_name: string;
  status: string;
  created_at: string;
}

export interface SellerItem {
  seller_id?: string;
  seller_phone: string;
  seller_name: string;
  store: string;
  balance: number;
  plan_name: string;
  plan_id: string | null;
  moderation: SellerModerationStatus;
  is_active: boolean;
  is_deleted_from_source?: boolean;
  outlets_count: number;
  employees_count: number;
  brands: string | null;
  organization_id: string | null;
  registered_at: string | null;
  last_activity: string | null;
  manager_id: string | null;
  synced_at: string;
  /** Итоги транзакций Sotka HQ (миграция 040): пополнения, списания и момент обновления */
  hq_topups_total?: number | null;
  hq_charges_total?: number | null;
  hq_tx_synced_at?: string | null;
  manager_user?: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
  } | null;
  linked_lead?: LinkedLeadInfo | null;
  /** Текущее подключение продавца (статус подтверждения администратором, миграция 037) */
  connection?: {
    connection_id: string;
    manager_id: string;
    confirmation_status: ConnectionConfirmationStatus;
    rejection_reason?: string | null;
    /** Участники подключения (043): основной первым */
    participants?: { user_id: string; full_name: string; role: string; login: string; color: string | null }[];
  } | null;
}

export interface GetSellersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  moderation?: string;
  isActive?: string; // 'all' | 'true' | 'false'
  managerId?: string; // 'all' | 'unassigned' | string
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface SellersResponse {
  sellers: SellerItem[];
  totalCount: number;
  currentUserRole?: UserRole;
  currentUserId?: string;
  hasAvailableLeads?: boolean;
  error?: string;
}

export interface SellersStats {
  total: number;
  active: number;
  pendingModeration: number;
  totalBalance: number;
  assigned: number;
}

/**
 * Запрос свободных лидов для привязки к продавцу в области видимости модуля «Лиды»:
 * без «leads.view_all» — только назначенные сотруднику или созданные им
 */
function availableLeadsCountQuery(ctx: Pick<AuthContext, 'canViewAll' | 'profile'>) {
  const admin = createAdminClient();
  let query = admin
    .from('leads')
    .select('lead_id', { count: 'exact', head: true })
    .is('seller_phone', null)
    .neq('status', 'Отмена');

  if (!ctx.canViewAll('leads')) {
    query = query.or(`assigned_to.eq.${ctx.profile.user_id},created_by.eq.${ctx.profile.user_id}`);
  }
  return query;
}

/**
 * Получение списка продавцов с пагинацией, фильтрацией, связанным лидом и изоляцией
 */
export async function getSellers(params: GetSellersParams = {}): Promise<SellersResponse> {
  let authCtx;
  try {
    authCtx = await requireAuth();
  } catch (err: any) {
    return { sellers: [], totalCount: 0, error: err?.message || 'Пользователь не аутентифицирован' };
  }
  const { profile } = authCtx;

  // Доступ к реестру продавцов — право «sellers.menu»
  if (!authCtx.can('sellers.menu')) {
    return {
      sellers: [],
      totalCount: 0,
      currentUserRole: profile.role as UserRole,
      currentUserId: profile.user_id,
      error: 'Недостаточно прав: доступ к реестру продавцов закрыт',
    };
  }

  // Права роли могут превышать базовую RLS-роль: читаем сервисным клиентом с явным фильтром области
  const supabase = createAdminClient();
  const viewAll = authCtx.canViewAll('sellers');

  const {
    page = 1,
    pageSize = 50,
    search,
    moderation,
    isActive,
    managerId,
    sortBy = 'registered_at',
    sortOrder = 'desc',
  } = params;

  let query = supabase.from('sellers').select(
    `
      seller_phone,
      seller_name,
      store,
      balance,
      plan_name,
      plan_id,
      moderation,
      is_active,
      outlets_count,
      employees_count,
      brands,
      organization_id,
      registered_at,
      last_activity,
      manager_id,
      synced_at
    `,
    { count: 'exact' }
  );

  // СТРОГАЯ ИЗОЛЯЦИЯ без «sellers.view_all»: только свои продавцы либо свободные одобренные
  if (!viewAll) {
    if (managerId === 'unassigned') {
      query = query.is('manager_id', null).eq('moderation', 'approved');
    } else if (managerId === profile.user_id || managerId === 'my') {
      query = query.eq('manager_id', profile.user_id);
    } else {
      query = query.or(sellersOwnScopeFilter(profile.user_id));
    }
  } else {
    // С правом «видеть всех» доступен произвольный фильтр по модерации и консультанту
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

  // Поиск по телефону, имени продавца или названию магазина
  if (search && search.trim()) {
    const cleanSearch = search.trim();
    query = query.or(
      `seller_phone.ilike.%${cleanSearch}%,seller_name.ilike.%${cleanSearch}%,store.ilike.%${cleanSearch}%`
    );
  }

  // Фильтр по активности
  if (isActive && isActive !== 'all') {
    query = query.eq('is_active', isActive === 'true');
  }

  // Сортировка: по умолчанию по дате регистрации, с уникальным ключом в конце
  query = applySellersOrder(query, sortBy, sortOrder);

  // Пагинация
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  // Параллельная проверка наличия свободных лидов для привязки (в области видимости лидов)
  const [{ data: sellersData, count, error }, { count: availableLeadsCount }] = await Promise.all([
    query,
    availableLeadsCountQuery(authCtx),
  ]);

  const hasAvailableLeads = (availableLeadsCount || 0) > 0;

  if (error) {
    console.error('Ошибка при получении продавцов:', error);
    return {
      sellers: [],
      totalCount: 0,
      currentUserRole: profile.role as UserRole,
      currentUserId: profile.user_id,
      hasAvailableLeads,
      error: error.message,
    };
  }

  // Параллельное обогащение данными менеджеров и связанных лидов
  const managerIds = Array.from(
    new Set((sellersData || []).map((s) => s.manager_id).filter((id): id is string => Boolean(id)))
  );
  const sellerPhones = (sellersData || []).map((s) => s.seller_phone);

  const [managersResult, leadsResult, connectionsResult] = await Promise.all([
    managerIds.length > 0
      ? supabase
          .from('users')
          .select('user_id, full_name, role, login, color')
          .in('user_id', managerIds)
      : Promise.resolve({ data: null }),
    sellerPhones.length > 0
      ? supabase
          .from('leads')
          .select('lead_id, client_name, status, created_at, seller_phone')
          .in('seller_phone', sellerPhones)
      : Promise.resolve({ data: null }),
    sellerPhones.length > 0
      ? supabase
          .from('connections')
          .select('connection_id, seller_phone, manager_id, confirmation_status, rejection_reason, assigned_at')
          .in('seller_phone', sellerPhones)
          .order('assigned_at', { ascending: false })
      : Promise.resolve({ data: null }),
  ]);

  // Текущее подключение продавца — статус подтверждения администратором (037)
  const connectionsMap = new Map<string, NonNullable<SellerItem['connection']>>();
  if (connectionsResult.data) {
    for (const c of connectionsResult.data) {
      if (!connectionsMap.has(c.seller_phone)) {
        connectionsMap.set(c.seller_phone, {
          connection_id: c.connection_id,
          manager_id: c.manager_id,
          confirmation_status: c.confirmation_status,
          rejection_reason: c.rejection_reason,
        });
      }
    }
  }

  const managersMap = new Map<string, { user_id: string; full_name: string; role: string; login: string; color?: string }>();
  if (managersResult.data) {
    managersResult.data.forEach((m) => managersMap.set(m.user_id, m));
  }

  const leadsMap = new Map<string, LinkedLeadInfo>();
  if (leadsResult.data) {
    leadsResult.data.forEach((l) => {
      if (l.seller_phone) {
        leadsMap.set(l.seller_phone, {
          lead_id: l.lead_id,
          client_name: l.client_name,
          status: l.status,
          created_at: l.created_at,
        });
      }
    });
  }

  const enrichedSellers: SellerItem[] = (sellersData || []).map((seller) => ({
    ...seller,
    manager_user: seller.manager_id ? managersMap.get(seller.manager_id) || null : null,
    linked_lead: leadsMap.get(seller.seller_phone) || null,
    connection: connectionsMap.get(seller.seller_phone) || null,
  }));

  return {
    sellers: enrichedSellers,
    totalCount: count || 0,
    currentUserRole: profile.role as UserRole,
    currentUserId: profile.user_id,
    hasAvailableLeads,
  };
}

/**
 * Проверка наличия свободных лидов, доступных для привязки к продавцу
 */
export async function checkAvailableLeadsExist(): Promise<boolean> {
  try {
    const authCtx = await requireAuth();

    if (!authCtx.can('sellers.menu')) {
      return false;
    }

    const { count, error } = await availableLeadsCountQuery(authCtx);
    if (error) {
      console.error('Ошибка проверки наличия доступных лидов:', error);
      return false;
    }

    return (count || 0) > 0;
  } catch (err) {
    console.error('Ошибка в checkAvailableLeadsExist:', err);
    return false;
  }
}

/**
 * Получение агрегированной статистики по базе продавцов с учетом роли
 */
export async function getSellersStats(): Promise<SellersStats> {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx || !authCtx.can('sellers.menu')) {
    return {
      total: 0,
      active: 0,
      pendingModeration: 0,
      totalBalance: 0,
      assigned: 0,
    };
  }
  const { supabase, profile } = authCtx;

  // Вызов SQL-агрегата get_sellers_kpi_stats (изолированный расчет по auth.uid() — клиент пользователя)
  try {
    const { data: rpcStats, error: rpcError } = await supabase.rpc('get_sellers_kpi_stats');
    if (!rpcError && rpcStats) {
      const stats = rpcStats as Record<string, any>;
      return {
        total: Number(stats.total) || 0,
        active: Number(stats.active) || 0,
        pendingModeration: Number(stats.pendingModeration) || 0,
        totalBalance: Number(stats.totalBalance) || 0,
        assigned: Number(stats.assigned) || 0,
      };
    }
  } catch (rpcErr) {
    console.warn('RPC get_sellers_kpi_stats недоступен, fallback на агрегацию:', rpcErr);
  }

  // Резервная агрегация: сервисный клиент с явным фильтром области видимости
  let fallbackQuery = createAdminClient()
    .from('sellers')
    .select('is_active, moderation, balance, manager_id');
  if (!authCtx.canViewAll('sellers')) {
    fallbackQuery = fallbackQuery.or(sellersOwnScopeFilter(profile.user_id));
  }
  const { data, error } = await fallbackQuery;

  if (error || !data) {
    return {
      total: 0,
      active: 0,
      pendingModeration: 0,
      totalBalance: 0,
      assigned: 0,
    };
  }

  let active = 0;
  let pendingModeration = 0;
  let totalBalance = 0;
  let assigned = 0;

  for (const s of data) {
    if (s.is_active) active++;
    if (s.moderation === 'pending') pendingModeration++;
    if (s.balance) totalBalance += Number(s.balance);
    if (s.manager_id) assigned++;
  }

  return {
    total: data.length,
    active,
    pendingModeration,
    totalBalance,
    assigned,
  };
}

/**
 * Получение списка сотрудников для назначения консультантом
 */
export async function getManagersList(): Promise<
  { user_id: string; full_name: string; role: string; login: string; color?: string }[]
> {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx || !authCtx.can('sellers.menu')) return [];

  // Справочник сотрудников для назначения (базовый enum здесь — данные, а не решение о доступе)
  const { data, error } = await createAdminClient()
    .from('users')
    .select('user_id, full_name, role, login, color')
    .eq('is_active', true)
    .in('role', ['admin', 'consultant', 'supervisor'])
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Ошибка при получении списка консультантов:', error);
    return [];
  }

  return (data as any) || [];
}

/**
 * Назначение/изменение консультанта продавца с автоматической фиксацией связи в connections
 * и расчетом вознаграждения для зарплат и выплат (право «sellers.assign»)
 * Поддерживает сброс обратно на null ("Не назначен")
 */
export async function assignSellerManager(
  sellerPhone: string,
  managerId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requirePermission('sellers.assign');
    const { profile } = ctx;

    if (!sellerPhone) {
      return { success: false, error: 'Не указан номер телефона продавца' };
    }

    // Подключение сразу подтверждено, если у назначающего есть право подтверждать (миграция 037);
    // иначе ожидает подтверждения
    const confirmation = ctx.can('connections.confirm') ? 'confirmed' : 'pending';
    const res = await assignSellerToManager({
      sellerPhone,
      managerId,
      actor: profile,
      confirmation,
    });
    if (!res.success) {
      return { success: false, error: res.error };
    }

    // Без права подтверждать: запрос администраторам с составом и одноразовой ссылкой (044)
    if (confirmation === 'pending' && res.connectionId) {
      const h = await headers();
      const host = h.get('x-forwarded-host') || h.get('host');
      const proto = h.get('x-forwarded-proto') || 'https';
      const { notifyConnectionPendingToAdmins } = await import('@/lib/services/connection-notifications');
      await notifyConnectionPendingToAdmins({ connectionId: res.connectionId, appOrigin: host ? `${proto}://${host}` : null }).catch(
        (err) => console.warn('[assignSellerManager] Уведомление администраторам не отправлено:', err)
      );
    }

    revalidatePath('/sellers');
    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/analytics');
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка назначения консультанта' };
  }
}

/**
 * Получение свободных лидов для привязки к продавцу
 * Приоритезирует статус 'Подписан'
 */
export async function getAvailableLeadsForSellerLinking(
  onlySigned: boolean = false
): Promise<{
  leads: {
    lead_id: string;
    client_name: string;
    phone: string;
    country_code?: string | null;
    status: string;
    assigned_to: string | null;
    assigned_user?: {
      user_id: string;
      full_name: string;
      color?: string;
    } | null;
    created_at: string;
  }[];
  error?: string;
}> {
  try {
    const ctx = await requirePermission('sellers.menu');
    const { profile } = ctx;

    let query = createAdminClient()
      .from('leads')
      .select(`
        lead_id,
        client_name,
        phone,
        country_code,
        status,
        assigned_to,
        created_at,
        assigned_user:users!leads_assigned_to_fkey(user_id, full_name, color)
      `)
      .is('seller_phone', null)
      .neq('status', 'Отмена');

    // Область видимости модуля «Лиды»: без «leads.view_all» — только свои
    if (!ctx.canViewAll('leads')) {
      query = query.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    if (onlySigned) {
      query = query.eq('status', 'Подписан');
    }

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data, error } = await query;

    if (error) {
      return { leads: [], error: error.message };
    }

    const sortedLeads = ((data as any) || []).sort((a: any, b: any) => {
      if (a.status === 'Подписан' && b.status !== 'Подписан') return -1;
      if (a.status !== 'Подписан' && b.status === 'Подписан') return 1;
      return 0;
    });

    return { leads: sortedLeads };
  } catch (err: any) {
    return { leads: [], error: err.message || 'Ошибка загрузки доступных лидов' };
  }
}

/**
 * Ручное связывание продавца с лидом (право «sellers.link_lead») с автоматическим
 * назначением консультанта из лида и мгновенным расчетом выплат в connections
 */
export async function linkSellerToLeadAction(
  sellerPhone: string,
  leadId: string
): Promise<{ success: boolean; error?: string; connectionFeeAmount?: number }> {
  try {
    const ctx = await requirePermission('sellers.link_lead');

    if (!sellerPhone || !leadId) {
      return { success: false, error: 'Не указан продавец или лид' };
    }

    const { data: sellerCheck } = await createAdminClient()
      .from('sellers')
      .select('seller_phone, manager_id, moderation')
      .eq('seller_phone', sellerPhone)
      .maybeSingle();

    if (sellerCheck && !isSellerInScope(ctx, sellerCheck)) {
      return { success: false, error: 'Продавец вне вашей области видимости' };
    }

    // Подключенный продавец: лид привязывается к существующему подключению (администратор или участник, 046)
    const result = await linkLeadToSellerAtomic(ctx, { leadId, sellerPhone, via: 'seller' });

    if (!result.success) {
      return { success: false, error: result.error || 'Ошибка при связывании продавца с лидом' };
    }

    revalidatePath('/sellers');
    revalidatePath('/leads');
    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/analytics');
    revalidatePath('/');

    return {
      success: true,
      connectionFeeAmount: result.connectionFeeAmount,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Сбой при связывании продавца с лидом' };
  }
}

/**
 * Синхронизация реестра продавцов из внешнего Sotka HQ API
 * GET /api/private/v1/admin/sellers-overview/?offset={offset}&limit={limit}
 * Пакетный upsert в Supabase таблицу 'sellers' по seller_phone
 * с сохранением существующих привязок консультантов (manager_id).
 *
 * Без limit выгружает весь реестр постранично (по 200 — максимум API);
 * с limit — только одну порцию начиная с offset.
 */
export async function syncSellersFromSotka(
  offset = 0,
  limit?: number
): Promise<{
  success: boolean;
  syncedCount: number;
  sellers: NormalizedSotkaSeller[];
  total: number;
  error?: string;
  errorCode?: string;
}> {
  let token = '';
  try {
    await requirePermission('sellers.sync');
    // Запись в sellers/plans разрешена RLS только администратору — после проверки права пишем сервисным клиентом
    const supabase = createAdminClient();
    const startedAt = Date.now();

    // 1. Авторизация во внешнем API Sotka
    token = await authenticateSotkaAdmin();

    // 2. Выгрузка продавцов: одна порция (limit задан) или весь реестр постранично
    const isPartialRequest = limit !== undefined;
    const PAGE_LIMIT = isPartialRequest ? Math.min(Math.max(limit, 1), 200) : 200;
    const items: SotkaSellerOverviewItem[] = [];
    let total = 0;
    let pageOffset = Math.max(offset, 0);
    let fetchedAllPages = false;

    for (;;) {
      const page = await fetchSellersOverview(token, pageOffset, PAGE_LIMIT);
      total = page.total || 0;
      items.push(...page.items);
      pageOffset += page.items.length;

      if (page.items.length < PAGE_LIMIT || pageOffset >= total) {
        fetchedAllPages = true;
        break;
      }
      if (isPartialRequest || Date.now() - startedAt > SYNC_TIME_BUDGET_MS) break;
    }

    if (items.length === 0) {
      return {
        success: true,
        syncedCount: 0,
        sellers: [],
        total,
      };
    }

    // 3. manager_id — локальное назначение CRM: в upsert не передается,
    // поэтому ON CONFLICT DO UPDATE не затирает консультанта существующих продавцов

    // 4. Справочник тарифов (защита foreign key constraint sellers_plan_id_fkey)
    const { data: dbPlans } = await supabase
      .from('plans')
      .select('plan_id, plan_name');

    const dbPlansMap = new Map<string, string>();
    const validPlanIds = new Set<string>();
    if (dbPlans) {
      for (const p of dbPlans) {
        validPlanIds.add(p.plan_id);
        dbPlansMap.set(p.plan_id.toLowerCase(), p.plan_id);
        dbPlansMap.set(p.plan_name.toLowerCase(), p.plan_id);
      }
    }

    // 4.1. Автоматическая предварительная регистрация новых тарифов
    const plansToUpsertMap = new Map<string, Database['public']['Tables']['plans']['Insert']>();
    for (const item of items) {
      const rawPlan = item.plans?.[0];
      if (
        rawPlan &&
        typeof rawPlan === 'string' &&
        rawPlan.trim() &&
        rawPlan.trim().toLowerCase() !== 'без тарифа'
      ) {
        const cleanName = rawPlan.trim();
        const resolved = resolveSotkaPlan(cleanName, dbPlansMap, validPlanIds);
        if (!resolved.planId || !validPlanIds.has(resolved.planId)) {
          const cleanSlug = cleanName
            .toUpperCase()
            .replace(/[^A-Z0-9А-ЯЁ]/gi, '')
            .slice(0, 16);
          const newPlanId = `PLN-${cleanSlug || 'CUSTOM'}`;
          plansToUpsertMap.set(newPlanId, {
            plan_id: newPlanId,
            plan_name: cleanName,
            price: 2500.0,
            billing_period: 'Месяц',
            description: 'Автоматически зарегистрирован при синхронизации Sotka API',
            is_active: true,
            updated_at: new Date().toISOString(),
          });
          validPlanIds.add(newPlanId);
          dbPlansMap.set(newPlanId.toLowerCase(), newPlanId);
          dbPlansMap.set(cleanName.toLowerCase(), newPlanId);
        }
      }
    }

    if (plansToUpsertMap.size > 0) {
      try {
        await supabase
          .from('plans')
          .upsert(Array.from(plansToUpsertMap.values()), { onConflict: 'plan_id' });
      } catch (planErr) {
        console.warn('[syncSellersFromSotka] Не удалось предварительно зарегистрировать тарифы:', planErr);
      }
    }

    // 5. Нормализация полученных продавцов
    const normalizedSellers: NormalizedSotkaSeller[] = items.map((item) =>
      normalizeSotkaSeller(item, {
        dbPlansMap,
        validPlanIds,
        preservedManagerId: null,
      })
    );

    // 6. Гарантированная дедупликация по первичному ключу seller_phone
    // во избежание ошибки Postgres: ON CONFLICT DO UPDATE command cannot affect row a second time
    const dedupedByPhoneMap = new Map<string, Database['public']['Tables']['sellers']['Insert']>();
    for (const s of normalizedSellers) {
      if (!s.seller_phone) continue;
      const row: Database['public']['Tables']['sellers']['Insert'] = {
        seller_phone: s.seller_phone,
        seller_name: s.seller_name,
        store: s.store,
        plan_id: s.plan_id,
        plan_name: s.plan_name,
        balance: s.balance,
        moderation: s.moderation,
        is_active: s.is_active,
        registered_at: s.registered_at,
        last_activity: s.last_activity,
        employees_count: s.employees_count,
        outlets_count: s.outlets_count,
        brands: s.brands,
        organization_id: s.organization_id || null,
        synced_at: s.synced_at || new Date().toISOString(),
        is_deleted_from_source: false,
      };

      const existing = dedupedByPhoneMap.get(s.seller_phone);
      if (existing) {
        // При наличии дубликатов по номеру объединяем свойства с приоритетом активности
        dedupedByPhoneMap.set(s.seller_phone, {
          ...existing,
          ...row,
          is_active: Boolean(existing.is_active || row.is_active),
          store: row.store || existing.store,
          organization_id: row.organization_id || existing.organization_id || null,
          brands: row.brands || existing.brands || null,
          registered_at: row.registered_at || existing.registered_at || null,
          last_activity: row.last_activity || existing.last_activity || null,
        });
      } else {
        dedupedByPhoneMap.set(s.seller_phone, row);
      }
    }

    const uniqueSellers = Array.from(dedupedByPhoneMap.values());

    // 6.1. Дата регистрации и последняя активность: если реестр Sotka их не передал,
    // сохраняем уже известные значения (upsert иначе затер бы их пустыми)
    const knownDates = new Map<string, { registered_at: string | null; last_activity: string | null }>();
    const phones = uniqueSellers.map((s) => s.seller_phone);
    for (let i = 0; i < phones.length; i += 200) {
      const { data: known } = await supabase
        .from('sellers')
        .select('seller_phone, registered_at, last_activity')
        .in('seller_phone', phones.slice(i, i + 200));
      for (const k of known || []) {
        knownDates.set(k.seller_phone, { registered_at: k.registered_at, last_activity: k.last_activity });
      }
    }
    for (const s of uniqueSellers) {
      const known = knownDates.get(s.seller_phone);
      if (!s.registered_at && known?.registered_at) s.registered_at = known.registered_at;
      if (!s.last_activity && known?.last_activity) s.last_activity = known.last_activity;
    }

    // 6.2. Нет даты регистрации ни в реестре, ни в CRM — берем из детальной карточки
    // GET /api/private/v1/admin/sellers-overview/{organization_id}/ (platform.registered_at).
    // Ограничено по количеству за один запуск: остальные дозаполнятся при следующих синхронизациях.
    const missingRegistration = uniqueSellers
      .filter((s) => !s.registered_at && s.organization_id)
      .slice(0, DETAIL_BACKFILL_LIMIT);
    for (let i = 0; i < missingRegistration.length; i += DETAIL_BACKFILL_CONCURRENCY) {
      if (Date.now() - startedAt > SYNC_TIME_BUDGET_MS) break;
      await Promise.all(
        missingRegistration.slice(i, i + DETAIL_BACKFILL_CONCURRENCY).map(async (s) => {
          try {
            const detail = await fetchSellerDetail(token, s.organization_id as string);
            s.registered_at = extractSellerDetailRegisteredAt(detail);
            if (!s.last_activity) {
              s.last_activity = parseDateToISO(detail?.platform?.last_activity);
            }
          } catch (detailErr: any) {
            console.warn(
              `[syncSellersFromSotka] Детальная карточка организации ${s.organization_id} недоступна:`,
              detailErr?.message
            );
          }
        })
      );
    }

    // 7. Сохранение пакетами (чанками) по 50 записей для предотвращения лимита параметров Postgres
    const CHUNK_SIZE = 50;
    let savedCount = 0;
    let hasDeletedFromSourceCol = true;

    for (let i = 0; i < uniqueSellers.length; i += CHUNK_SIZE) {
      let chunk = uniqueSellers.slice(i, i + CHUNK_SIZE);
      if (!hasDeletedFromSourceCol) {
        chunk = chunk.map(({ is_deleted_from_source, ...rest }: any) => rest);
      }

      let { error: chunkUpsertErr } = await supabase
        .from('sellers')
        .upsert(chunk, { onConflict: 'seller_phone', ignoreDuplicates: false });

      // Грациозный fallback: если колонка is_deleted_from_source еще не создана в БД
      if (chunkUpsertErr && chunkUpsertErr.message?.includes('is_deleted_from_source')) {
        console.warn(
          `[syncSellersFromSotka] Колонка is_deleted_from_source отсутствует в схеме БД. Повторяем сохранение без нее...`
        );
        hasDeletedFromSourceCol = false;
        const sanitizedChunk = chunk.map(({ is_deleted_from_source, ...rest }: any) => rest);
        const retryRes = await supabase
          .from('sellers')
          .upsert(sanitizedChunk, { onConflict: 'seller_phone', ignoreDuplicates: false });
        chunkUpsertErr = retryRes.error;
      }

      if (chunkUpsertErr) {
        console.error(
          `[syncSellersFromSotka] Ошибка при сохранении чанка [${i}..${i + chunk.length}]:`,
          chunkUpsertErr
        );
        throw new Error(`Ошибка сохранения продавцов в базу данных: ${chunkUpsertErr.message}`);
      }
      savedCount += chunk.length;
    }

    // 7.1. Итоги транзакций Sotka HQ (пополнения / списания по успешным операциям) из детальной
    // карточки продавца: сначала без итогов, затем устаревшие — в пределах бюджета времени.
    // Остальные дозаполняет реестр продавцов (POST /api/v1/sellers/hq-totals) и вкладка транзакций.
    try {
      const hq = await refreshSellersHqTotals({
        token,
        phones,
        staleHours: 24,
        limit: HQ_TOTALS_REFRESH_LIMIT,
        timeBudgetMs: SYNC_TIME_BUDGET_MS,
        startedAt,
      });
      console.log(`[Sellers Sync] Итоги транзакций Sotka HQ обновлены: ${hq.refreshed} из ${hq.queued}`);
    } catch (hqErr: any) {
      console.warn('[syncSellersFromSotka] Не удалось обновить итоги транзакций Sotka HQ:', hqErr?.message);
    }

    // 8. Выявление продавцов, удаленных во внешнем Sotka HQ API (Soft-delete).
    // Только если выгружен весь список Sotka: при частичной синхронизации (offset/limit)
    // все продавцы вне порции ошибочно помечались бы удаленными.
    // Синхронизированные продавцы уже получили is_deleted_from_source = false в upsert.
    const syncedOrgIds = items
      .map((item) => (item.organization_id !== undefined && item.organization_id !== null ? String(item.organization_id) : ''))
      .filter(Boolean);
    const isFullPass = offset === 0 && fetchedAllPages && items.length >= (total || 0);

    if (isFullPass && syncedOrgIds.length > 0 && hasDeletedFromSourceCol) {
      try {
        const syncedSet = new Set(syncedOrgIds);
        const phonesToMarkDeleted: string[] = [];

        // Постраничное чтение: PostgREST по умолчанию отдает не более 1000 строк
        const PAGE_SIZE = 1000;
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data: page, error: pageErr } = await supabase
            .from('sellers')
            .select('seller_phone, organization_id')
            .not('organization_id', 'is', null)
            .order('seller_phone')
            .range(from, from + PAGE_SIZE - 1);

          if (pageErr) throw pageErr;
          for (const ls of page || []) {
            if (ls.organization_id && !syncedSet.has(String(ls.organization_id))) {
              phonesToMarkDeleted.push(ls.seller_phone);
            }
          }
          if (!page || page.length < PAGE_SIZE) break;
        }

        const UPDATE_CHUNK = 200;
        for (let i = 0; i < phonesToMarkDeleted.length; i += UPDATE_CHUNK) {
          const { error: markErr } = await supabase
            .from('sellers')
            .update({ is_deleted_from_source: true })
            .in('seller_phone', phonesToMarkDeleted.slice(i, i + UPDATE_CHUNK));
          if (markErr) throw markErr;
        }
      } catch (softDelErr) {
        console.warn('[syncSellersFromSotka] Ошибка при актуализации is_deleted_from_source:', softDelErr);
      }
    }

    // Подробное серверное логирование
    console.log(
      `[Sellers Sync] Получено от API: ${items.length} из ${total}, уникальных после дедупликации: ${uniqueSellers.length}, успешно сохранено: ${savedCount}, без даты регистрации: ${uniqueSellers.filter((s) => !s.registered_at).length}`
    );

    revalidatePath('/sellers');
    revalidatePath('/leads');
    revalidatePath('/analytics');
    revalidatePath('/');

    return {
      success: true,
      syncedCount: uniqueSellers.length,
      sellers: normalizedSellers,
      total,
    };
  } catch (err: any) {
    console.error('[syncSellersFromSotka] Сбой синхронизации продавцов:', err);
    return {
      success: false,
      syncedCount: 0,
      sellers: [],
      total: 0,
      error: err.message || 'Ошибка синхронизации продавцов с Sotka API',
      errorCode: err instanceof SotkaAuthError ? err.code : undefined,
    };
  } finally {
    if (token) await logoutSotkaSession(token);
  }
}

/**
 * Получение детальной карточки продавца напрямую из внешнего API Sotka HQ
 * GET /api/private/v1/admin/sellers-overview/{organization_id}/
 */
export async function getSellerDetailFromSotka(
  organizationId: number | string
): Promise<{ success: boolean; detail?: SotkaSellerDetail; error?: string }> {
  try {
    await requirePermission('sellers.sync');
    const token = await authenticateSotkaAdmin();
    const detail = await fetchSellerDetail(token, organizationId);
    return { success: true, detail };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Ошибка получения детальной информации продавца из Sotka API',
    };
  }
}

/**
 * Безвозвратное удаление продавца (право «sellers.delete») с каскадной очисткой связок
 */
export async function deleteSellerPermanently(
  sellerPhoneOrId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('sellers.delete');
    const supabase = createAdminClient();

    // 1. Находим продавца (в sellers нет колонки seller_id: ищем по organization_id или телефону)
    const seller = await findSellerByKey(supabase, sellerPhoneOrId, ['seller_phone'] as const);
    if (!seller) {
      return { success: false, error: 'Продавец не найден' };
    }
    const targetPhone = seller.seller_phone;

    // 2. Отвязываем лиды
    await supabase
      .from('leads')
      .update({ seller_phone: null, linked_at: null, status: 'Назначен' } as any)
      .eq('seller_phone', targetPhone);

    // 3. Удаляем связанные подключения
    await supabase
      .from('connections')
      .delete()
      .eq('seller_phone', targetPhone);

    // 4. Удаляем самого продавца
    const { error: delErr } = await supabase
      .from('sellers')
      .delete()
      .eq('seller_phone', targetPhone);

    if (delErr) throw delErr;

    revalidatePath('/sellers');
    revalidatePath('/leads');
    revalidatePath('/connections');
    revalidatePath('/analytics');
    revalidatePath('/');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка полного удаления продавца' };
  }
}



