'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuth, type AuthContext } from '@/lib/auth/check-role';
import { fullPhoneSchema, employeeProfileFieldsSchema } from '@/lib/validations';
import type { Database, UserRole } from '@/types/database.types';

export interface UserProfileData {
  user_id: string;
  login: string;
  full_name: string;
  phone: string | null;
  /** Базовый профиль (устаревший enum), синхронизируется с назначенной ролью */
  role: UserRole;
  /** Назначенная роль (roles.role_id) */
  role_id: string | null;
  role_name: string | null;
  is_active: boolean;
  color: string;
  created_at: string;
  /** Последняя активность в CRM (миграция 041) */
  last_active_at: string | null;
  /** Анкета сотрудника (миграция 030) */
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  inn: string | null;
  birth_date: string | null;
  gender: string | null;
  bio: string | null;
  telegram_username: string | null;
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

const PROFILE_COLUMNS =
  'user_id, login, full_name, phone, role, role_id, roles:role_id(name), is_active, color, created_at, last_active_at, address, latitude, longitude, inn, birth_date, gender, bio, telegram_username';

/** Строка users с присоединенной ролью → UserProfileData (role_name сплющивается из roles) */
function toProfileData(row: any): UserProfileData {
  const { roles, ...rest } = row;
  const roleJoin = Array.isArray(roles) ? roles[0] || null : roles;
  return {
    ...rest,
    role_id: rest.role_id ?? null,
    role_name: roleJoin?.name ?? null,
  };
}

async function loadProfile(userId: string): Promise<UserProfileData | null> {
  const { data, error } = await createAdminClient()
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return toProfileData(data);
}

/**
 * Получение профиля пользователя и расчет персональных KPI.
 * Свой профиль доступен всегда; чужой — при праве profile.others.
 * Состав KPI выбирается по базовому профилю (enum) целевого сотрудника — это данные, а не решение о доступе.
 */
export async function getUserProfileAndKpi(targetUserId?: string): Promise<UserKpiResponse> {
  let ctx: AuthContext;
  try {
    ctx = await requireAuth();
  } catch (err: any) {
    return { profile: null, role: 'consultant', error: err?.message || 'Пользователь не авторизован' };
  }

  const callerRole = ctx.profile.role;
  const callerId = ctx.profile.user_id;

  // Если запрошен профиль другого пользователя
  const isOther = Boolean(targetUserId && targetUserId !== callerId);
  if (isOther && !ctx.can('profile.others')) {
    return {
      profile: null,
      role: callerRole,
      currentUserRole: callerRole,
      error: 'Недостаточно прав: открывать профили других сотрудников',
    };
  }

  const targetProfile = await loadProfile(isOther ? (targetUserId as string) : callerId);
  if (!targetProfile) {
    return {
      profile: null,
      role: callerRole,
      currentUserRole: callerRole,
      error: isOther ? 'Запрошенный сотрудник не найден' : 'Профиль не найден',
    };
  }

  const role = targetProfile.role as UserRole;
  const userId = targetProfile.user_id;
  const currentMonth = new Date().toISOString().substring(0, 7);
  // Права проверены выше; выборки по целевому сотруднику — сервисным клиентом с явным фильтром по userId
  const admin = createAdminClient();
  // Денежные показатели чужого профиля — только при праве видеть операции всех сотрудников
  const canSeePayouts = !isOther || ctx.canViewAll('payouts');

  // 1. KPI для SMM-специалиста
  if (role === 'smm') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const { data: userLeads } = await admin
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
    const { data: assignedLeads } = await admin
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
    const { data: connections } = await admin
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
    const { data: maintenance } = await admin
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
    let monthTotalPayouts = 0;
    if (canSeePayouts) {
      const { data: payouts } = await admin
        .from('employee_payouts')
        .select('amount, payout_category')
        .eq('user_id', userId)
        .eq('accrual_month', currentMonth);

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

  // 3. KPI для Администратора / руководителя
  // Статистические RPC опираются на auth.uid() в БД — вызываются клиентом пользователя
  const [funnelRpcRes, sellersRpcRes, payoutsRes, lastSyncRes] = await Promise.all([
    ctx.supabase.rpc('get_leads_funnel_stats'),
    ctx.supabase.rpc('get_sellers_kpi_stats'),
    canSeePayouts
      ? admin.from('employee_payouts').select('amount, payout_category').eq('accrual_month', currentMonth)
      : Promise.resolve({ data: [] as { amount: number; payout_category: string | null }[] }),
    admin
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
 * Получение всех сотрудников для селектора профилей (profile.others)
 */
export async function getAllUsersForAdmin(): Promise<{
  users: UserProfileData[];
  error?: string;
}> {
  try {
    const ctx = await requireAuth();
    if (!ctx.can('profile.others')) {
      return { users: [], error: 'Недостаточно прав: открывать профили других сотрудников' };
    }
  } catch (err: any) {
    return { users: [], error: err?.message || 'Не авторизован' };
  }

  const { data: allUsers, error } = await createAdminClient()
    .from('users')
    .select(PROFILE_COLUMNS)
    .order('full_name', { ascending: true });

  if (error) {
    return { users: [], error: error.message };
  }

  return { users: ((allUsers || []) as any[]).map(toProfileData) };
}

/**
 * Редактирование профиля: свой — ФИО, телефон, цвет; чужой — employees.edit;
 * роль (role / role_id) — employees.edit; активность — employees.edit + employees.deactivate
 */
export async function updateProfileData(input: {
  full_name?: string;
  phone?: string | null;
  role?: UserRole;
  role_id?: string;
  is_active?: boolean;
  color?: string;
  targetUserId?: string;
  /** Анкета: адрес, координаты, ИНН, дата рождения, пол, биография (свой профиль — всегда) */
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  inn?: string | null;
  birth_date?: string | null;
  gender?: 'male' | 'female' | null;
  bio?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  let ctx: AuthContext;
  try {
    ctx = await requireAuth();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Пользователь не авторизован' };
  }

  const callerId = ctx.profile.user_id;
  const isEditingOther = Boolean(input.targetUserId && input.targetUserId !== callerId);

  if (isEditingOther && !ctx.can('employees.edit')) {
    return { success: false, error: 'Недостаточно прав: редактировать других сотрудников' };
  }

  const changesRole = input.role !== undefined || input.role_id !== undefined;
  if (changesRole && !ctx.can('employees.edit')) {
    return { success: false, error: 'Недостаточно прав: менять роль сотрудника' };
  }
  if (input.is_active !== undefined && !(ctx.can('employees.edit') && ctx.can('employees.deactivate'))) {
    return { success: false, error: 'Недостаточно прав: блокировать и разблокировать сотрудников' };
  }

  const targetId = input.targetUserId || callerId;

  const updates: Database['public']['Tables']['users']['Update'] = {};
  if (input.full_name !== undefined) {
    if (input.full_name.trim().length < 2) {
      return { success: false, error: 'ФИО должно содержать минимум 2 символа' };
    }
    updates.full_name = input.full_name.trim();
  }

  if (input.phone !== undefined) {
    // Полный номер с кодом страны СНГ, хранится цифрами («996555123456»)
    const parsedPhone = fullPhoneSchema.safeParse(input.phone);
    if (!parsedPhone.success) {
      return { success: false, error: parsedPhone.error.issues[0]?.message || 'Некорректный номер телефона' };
    }
    updates.phone = parsedPhone.data ?? null;
  }

  if (input.color !== undefined) {
    updates.color = input.color;
  }

  // Анкета сотрудника: валидация теми же правилами, что и в модуле «Сотрудники»
  const PROFILE_FIELD_KEYS = ['address', 'latitude', 'longitude', 'inn', 'birth_date', 'gender', 'bio'] as const;
  const profileInput: Record<string, unknown> = {};
  for (const key of PROFILE_FIELD_KEYS) {
    if (input[key] !== undefined) profileInput[key] = input[key];
  }
  if (Object.keys(profileInput).length > 0) {
    const parsedProfile = employeeProfileFieldsSchema.safeParse(profileInput);
    if (!parsedProfile.success) {
      return { success: false, error: parsedProfile.error.issues[0]?.message || 'Ошибка в анкете сотрудника' };
    }
    const lat = parsedProfile.data.latitude ?? null;
    const lon = parsedProfile.data.longitude ?? null;
    if ((lat === null) !== (lon === null) && (parsedProfile.data.latitude !== undefined || parsedProfile.data.longitude !== undefined)) {
      return { success: false, error: 'Укажите и широту, и долготу (или очистите оба поля)' };
    }
    for (const key of PROFILE_FIELD_KEYS) {
      if (parsedProfile.data[key] !== undefined) (updates as Record<string, unknown>)[key] = parsedProfile.data[key];
    }
  }

  if (input.role_id !== undefined) {
    // Назначенная роль; триггер БД синхронизирует устаревший enum
    updates.role_id = input.role_id;
  } else if (input.role !== undefined) {
    updates.role = input.role;
  }
  if (input.is_active !== undefined) {
    updates.is_active = input.is_active;
  }

  const adminClient = createAdminClient();
  const { data: updatedUser, error: updateError } = await adminClient
    .from('users')
    .update(updates)
    .eq('user_id', targetId)
    .select('auth_id, full_name, role')
    .single();

  if (updateError) {
    const msg = updateError.message;
    const friendly = msg.includes('users_inn_unique')
      ? 'Сотрудник с таким ИНН уже есть в системе'
      : msg.includes('users_inn_format')
      ? 'ИНН должен состоять из 14 цифр'
      : msg.includes('users_coordinates_pair')
      ? 'Укажите и широту, и долготу'
      : msg;
    return { success: false, error: friendly };
  }

  // Синхронизируем метаданные в auth.users через сервисный клиент
  if (updatedUser?.auth_id) {
    try {
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
 * Смена пароля (для себя всегда; чужой пароль — employees.reset_password)
 */
export async function changeUserPassword(input: {
  newPassword: string;
  targetUserId?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!input.newPassword || input.newPassword.length < 6) {
    return { success: false, error: 'Пароль должен содержать не менее 6 символов' };
  }

  let ctx: AuthContext;
  try {
    ctx = await requireAuth();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Пользователь не авторизован' };
  }

  const isResettingOther = Boolean(input.targetUserId && input.targetUserId !== ctx.profile.user_id);

  if (isResettingOther && !ctx.can('employees.reset_password')) {
    return { success: false, error: 'Недостаточно прав: сбрасывать пароли других сотрудников' };
  }

  try {
    const adminClient = createAdminClient();

    let targetAuthId = ctx.user.id;

    if (isResettingOther) {
      const { data: targetUser, error: findError } = await adminClient
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
