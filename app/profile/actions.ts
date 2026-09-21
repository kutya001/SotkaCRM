'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, UserRole, LeadStatus } from '@/types/database.types';

export interface UserProfileData {
  user_id: string;
  login: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  color: string;
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
  currentUserRole?: UserRole;
  smmStats?: SmmKpiStats;
  consultantStats?: ConsultantKpiStats;
  adminStats?: AdminKpiStats;
  error?: string;
}

/**
 * Получение профиля пользователя и расчет персональных KPI.
 * Если передан targetUserId, только администратор может просмотреть данные другого сотрудника.
 */
export async function getUserProfileAndKpi(targetUserId?: string): Promise<UserKpiResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { profile: null, role: 'consultant', error: 'Пользователь не авторизован' };
  }

  const { data: callerProfile } = await supabase
    .from('users')
    .select('user_id, login, full_name, phone, role, is_active, color, created_at')
    .eq('auth_id', user.id)
    .single();

  if (!callerProfile) {
    return { profile: null, role: 'consultant', error: 'Профиль не найден' };
  }

  const callerRole = callerProfile.role as UserRole;
  let targetProfile: UserProfileData = callerProfile;

  // Если запрошен профиль другого пользователя
  if (targetUserId && targetUserId !== callerProfile.user_id) {
    if (callerRole !== 'admin') {
      return {
        profile: null,
        role: callerRole,
        currentUserRole: callerRole,
        error: 'Доступ к чужим профилям разрешен только администратору',
      };
    }

    const { data: requestedUser, error: targetError } = await supabase
      .from('users')
      .select('user_id, login, full_name, phone, role, is_active, color, created_at')
      .eq('user_id', targetUserId)
      .single();

    if (targetError || !requestedUser) {
      return {
        profile: null,
        role: callerRole,
        currentUserRole: callerRole,
        error: 'Запрошенный сотрудник не найден',
      };
    }

    targetProfile = requestedUser;
  }

  const role = targetProfile.role as UserRole;
  const userId = targetProfile.user_id;
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
      profile: targetProfile,
      role,
      currentUserRole: callerRole,
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
      profile: targetProfile,
      role,
      currentUserRole: callerRole,
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
  const [funnelRpcRes, sellersRpcRes, payoutsRes, lastSyncRes] = await Promise.all([
    supabase.rpc('get_leads_funnel_stats'),
    supabase.rpc('get_sellers_kpi_stats'),
    supabase
      .from('employee_payouts')
      .select('amount, payout_category')
      .eq('accrual_month', currentMonth),
    supabase
      .from('sellers')
      .select('synced_at')
      .order('synced_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const funnelData = (funnelRpcRes.data as any) || {};
  const funnel = {
    total: Number(funnelData.total) || 0,
    open: Number(funnelData.open) || 0,
    processed: Number(funnelData.processed) || 0,
    assigned: Number(funnelData.assigned) || 0,
    signed: Number(funnelData.signed) || 0,
    cancelled: Number(funnelData.cancelled) || 0,
  };

  // Зарплатный фонд текущего месяца
  const payouts = payoutsRes.data || [];
  let totalPayoutFundMonth = 0;
  for (const p of payouts) {
    const amt = Number(p.amount) || 0;
    if (p.payout_category !== 'удержание') {
      totalPayoutFundMonth += amt;
    }
  }

  const sellersData = (sellersRpcRes.data as any) || {};
  const totalActiveSellers = Number(sellersData.active) || 0;
  const totalSellersBalance = Number(sellersData.totalBalance) || 0;
  const lastSyncedAt = lastSyncRes.data?.synced_at || null;

  return {
    profile: targetProfile,
    role,
    currentUserRole: callerRole,
    adminStats: {
      leadsFunnel: funnel,
      totalPayoutFundMonth: Math.round(totalPayoutFundMonth * 100) / 100,
      totalActiveSellers,
      totalSellersBalance: Math.round(totalSellersBalance * 100) / 100,
      lastSyncedAt,
    },
  };
}

/**
 * Получение всех сотрудников для селектора администратора
 */
export async function getAllUsersForAdmin(): Promise<{
  users: UserProfileData[];
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { users: [], error: 'Не авторизован' };
  }

  const { data: callerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_id', user.id)
    .single();

  if (!callerProfile || callerProfile.role !== 'admin') {
    return { users: [], error: 'Доступно только администратору' };
  }

  const { data: allUsers, error } = await supabase
    .from('users')
    .select('user_id, login, full_name, phone, role, is_active, color, created_at')
    .order('full_name', { ascending: true });

  if (error) {
    return { users: [], error: error.message };
  }

  return { users: allUsers || [] };
}

/**
 * Редактирование профиля (ФИО, телефон, и если администратор — роль и активность)
 */
export async function updateProfileData(input: {
  full_name?: string;
  phone?: string | null;
  role?: UserRole;
  is_active?: boolean;
  color?: string;
  targetUserId?: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Пользователь не авторизован' };
  }

  const { data: callerProfile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  if (!callerProfile) {
    return { success: false, error: 'Профиль не найден' };
  }

  const isEditingOther = input.targetUserId && input.targetUserId !== callerProfile.user_id;

  if (isEditingOther && callerProfile.role !== 'admin') {
    return { success: false, error: 'Редактирование чужого профиля доступно только администратору' };
  }

  const targetId = input.targetUserId || callerProfile.user_id;

  const updates: Database['public']['Tables']['users']['Update'] = {};
  if (input.full_name !== undefined) {
    if (input.full_name.trim().length < 2) {
      return { success: false, error: 'ФИО должно содержать минимум 2 символа' };
    }
    updates.full_name = input.full_name.trim();
  }

  if (input.phone !== undefined) {
    updates.phone = input.phone?.trim() || null;
  }

  if (input.color !== undefined) {
    updates.color = input.color;
  }

  // Только администратор может менять роль и статус активности
  if (callerProfile.role === 'admin') {
    if (input.role !== undefined) {
      updates.role = input.role;
    }
    if (input.is_active !== undefined) {
      updates.is_active = input.is_active;
    }
  }

  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update(updates)
    .eq('user_id', targetId)
    .select('auth_id, full_name, role')
    .single();

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Синхронизируем метаданные в auth.users через сервисный клиент
  if (updatedUser?.auth_id) {
    try {
      const adminClient = createAdminClient();
      await adminClient.auth.admin.updateUserById(updatedUser.auth_id, {
        user_metadata: {
          full_name: updatedUser.full_name,
          role: updatedUser.role,
        },
      });
    } catch (metaErr) {
      console.warn('Предупреждение при обновлении auth_metadata:', metaErr);
    }
  }

  revalidatePath('/profile');
  revalidatePath('/employees');
  revalidatePath('/leads');
  revalidatePath('/sellers');
  return { success: true };
}

/**
 * Смена пароля (для себя или сброс пароля любого сотрудника администратором)
 */
export async function changeUserPassword(input: {
  newPassword: string;
  targetUserId?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!input.newPassword || input.newPassword.length < 6) {
    return { success: false, error: 'Пароль должен содержать не менее 6 символов' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Пользователь не авторизован' };
  }

  const { data: callerProfile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  if (!callerProfile) {
    return { success: false, error: 'Профиль пользователя не найден' };
  }

  const isResettingOther = input.targetUserId && input.targetUserId !== callerProfile.user_id;

  if (isResettingOther && callerProfile.role !== 'admin') {
    return { success: false, error: 'Сброс паролей других пользователей доступен только администратору' };
  }

  try {
    const adminClient = createAdminClient();

    let targetAuthId = user.id;

    if (isResettingOther) {
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('auth_id')
        .eq('user_id', input.targetUserId!)
        .single();

      if (findError || !targetUser?.auth_id) {
        return { success: false, error: 'Сотрудник для смены пароля не найден' };
      }
      targetAuthId = targetUser.auth_id;
    }

    const { error: authError } = await adminClient.auth.admin.updateUserById(targetAuthId, {
      password: input.newPassword,
    });

    if (authError) {
      return { success: false, error: authError.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Ошибка при смене пароля:', err);
    return { success: false, error: err?.message || 'Не удалось обновить пароль' };
  }
}
