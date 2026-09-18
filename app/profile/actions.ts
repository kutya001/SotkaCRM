'use server';

import { createClient } from '@/lib/supabase/server';
import type { Database, UserRole, LeadStatus } from '@/types/database.types';

export interface UserProfileData {
  user_id: string;
  login: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface SmmKpiStats {
  todayLeads: number;
  weekLeads: number;
  monthLeads: number;
  totalLeads: number;
  cancelledLeads: number;
  signedLeads: number;
  cancellationRate: number;
  signedRate: number;
}

export interface ConsultantKpiStats {
  activeAssignedLeads: number;
  closedDeals: number;
  monthConnectionBonus: number;
  monthMaintenanceBonus: number;
  monthTotalEarnings: number;
  monthTotalPayouts: number;
  totalActiveClients: number;
}

export interface AdminKpiStats {
  leadsFunnel: {
    total: number;
    open: number;
    processed: number;
    assigned: number;
    signed: number;
    cancelled: number;
  };
  totalPayoutFundMonth: number;
  totalActiveSellers: number;
  totalSellersBalance: number;
  lastSyncedAt: string | null;
}

export interface UserKpiResponse {
  profile: UserProfileData | null;
  role: UserRole;
  smmStats?: SmmKpiStats;
  consultantStats?: ConsultantKpiStats;
  adminStats?: AdminKpiStats;
  error?: string;
}

/**
 * Получение профиля текущего пользователя и расчет персональных KPI
 */
export async function getUserProfileAndKpi(): Promise<UserKpiResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { profile: null, role: 'consultant', error: 'Пользователь не авторизован' };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, login, full_name, phone, role, is_active, created_at')
    .eq('auth_id', user.id)
    .single();

  if (!profile) {
    return { profile: null, role: 'consultant', error: 'Профиль не найден' };
  }

  const role = profile.role as UserRole;
  const userId = profile.user_id;
  const currentMonth = new Date().toISOString().substring(0, 7);

  // 1. KPI для SMM-специалиста
  if (role === 'smm') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const { data: userLeads } = await supabase
      .from('leads')
      .select('lead_id, status, created_at')
      .eq('created_by', userId);

    const leads = userLeads || [];
    const totalLeads = leads.length;

    let todayLeads = 0;
    let weekLeads = 0;
    let monthLeads = 0;
    let cancelledLeads = 0;
    let signedLeads = 0;

    for (const l of leads) {
      const d = new Date(l.created_at);
      if (d >= startOfDay) todayLeads++;
      if (d >= startOfWeek) weekLeads++;
      if (d >= startOfMonth) monthLeads++;
      if (l.status === 'Отмена') cancelledLeads++;
      if (l.status === 'Подписан') signedLeads++;
    }

    const cancellationRate = totalLeads > 0 ? Math.round((cancelledLeads / totalLeads) * 100) : 0;
    const signedRate = totalLeads > 0 ? Math.round((signedLeads / totalLeads) * 100) : 0;

    return {
      profile,
      role,
      smmStats: {
        todayLeads,
        weekLeads,
        monthLeads,
        totalLeads,
        cancelledLeads,
        signedLeads,
        cancellationRate,
        signedRate,
      },
    };
  }

  // 2. KPI для Продавца-консультанта
  if (role === 'consultant') {
    // Активные лиды в работе
    const { data: assignedLeads } = await supabase
      .from('leads')
      .select('status')
      .eq('assigned_to', userId);

    let activeAssignedLeads = 0;
    let closedDeals = 0;
    if (assignedLeads) {
      for (const l of assignedLeads) {
        if (l.status === 'Открыт' || l.status === 'Обработан' || l.status === 'Назначен') {
          activeAssignedLeads++;
        }
        if (l.status === 'Подписан') {
          closedDeals++;
        }
      }
    }

    // Бонусы за подключение в текущем месяце
    const { data: connections } = await supabase
      .from('connections')
      .select('connection_fee_amount, client_status, accrual_month')
      .eq('manager_id', userId);

    let monthConnectionBonus = 0;
    let totalActiveClients = 0;
    if (connections) {
      for (const c of connections) {
        if (c.accrual_month === currentMonth) {
          monthConnectionBonus += Number(c.connection_fee_amount) || 0;
        }
        if (c.client_status === 'подключен' || c.client_status === 'сопровождение') {
          totalActiveClients++;
        }
      }
    }

    // Бонусы за сопровождение в текущем месяце
    const { data: maintenance } = await supabase
      .from('client_maintenance')
      .select('maintenance_amount')
      .eq('manager_id', userId)
      .eq('accrual_month', currentMonth);

    let monthMaintenanceBonus = 0;
    if (maintenance) {
      for (const m of maintenance) {
        monthMaintenanceBonus += Number(m.maintenance_amount) || 0;
      }
    }

    // Фактические выплаты за текущий месяц
    const { data: payouts } = await supabase
      .from('employee_payouts')
      .select('amount, payout_category')
      .eq('user_id', userId)
      .eq('accrual_month', currentMonth);

    let monthTotalPayouts = 0;
    if (payouts) {
      for (const p of payouts) {
        const amt = Number(p.amount) || 0;
        if (p.payout_category === 'удержание') {
          monthTotalPayouts -= amt;
        } else {
          monthTotalPayouts += amt;
        }
      }
    }

    return {
      profile,
      role,
      consultantStats: {
        activeAssignedLeads,
        closedDeals,
        monthConnectionBonus: Math.round(monthConnectionBonus * 100) / 100,
        monthMaintenanceBonus: Math.round(monthMaintenanceBonus * 100) / 100,
        monthTotalEarnings: Math.round((monthConnectionBonus + monthMaintenanceBonus) * 100) / 100,
        monthTotalPayouts: Math.round(monthTotalPayouts * 100) / 100,
        totalActiveClients,
      },
    };
  }

  // 3. KPI для Администратора
  const { data: allLeads } = await supabase.from('leads').select('status');
  const funnel = {
    total: allLeads?.length || 0,
    open: 0,
    processed: 0,
    assigned: 0,
    signed: 0,
    cancelled: 0,
  };

  if (allLeads) {
    for (const l of allLeads) {
      if (l.status === 'Открыт') funnel.open++;
      else if (l.status === 'Обработан') funnel.processed++;
      else if (l.status === 'Назначен') funnel.assigned++;
      else if (l.status === 'Подписан') funnel.signed++;
      else if (l.status === 'Отмена') funnel.cancelled++;
    }
  }

  // Зарплатный фонд текущего месяца
  const { data: payouts } = await supabase
    .from('employee_payouts')
    .select('amount, payout_category')
    .eq('accrual_month', currentMonth);

  let totalPayoutFundMonth = 0;
  if (payouts) {
    for (const p of payouts) {
      const amt = Number(p.amount) || 0;
      if (p.payout_category !== 'удержание') {
        totalPayoutFundMonth += amt;
      }
    }
  }

  // Продавцы и их суммарный баланс
  const { data: sellers } = await supabase
    .from('sellers')
    .select('balance, is_active, synced_at');

  let totalActiveSellers = 0;
  let totalSellersBalance = 0;
  let lastSyncedAt: string | null = null;

  if (sellers) {
    for (const s of sellers) {
      if (s.is_active) totalActiveSellers++;
      totalSellersBalance += Number(s.balance) || 0;
      if (s.synced_at) {
        if (!lastSyncedAt || s.synced_at > lastSyncedAt) {
          lastSyncedAt = s.synced_at;
        }
      }
    }
  }

  return {
    profile,
    role,
    adminStats: {
      leadsFunnel: funnel,
      totalPayoutFundMonth: Math.round(totalPayoutFundMonth * 100) / 100,
      totalActiveSellers,
      totalSellersBalance: Math.round(totalSellersBalance * 100) / 100,
      lastSyncedAt,
    },
  };
}
