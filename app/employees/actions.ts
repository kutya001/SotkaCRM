'use server';

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCrmUser } from '@/app/auth/actions';
import { createEmployeeSchema, updateEmployeeSchema } from '@/lib/validations';
import { isValidHex, normalizeHex } from '@/lib/constants/colors';
import type { Database, UserRole } from '@/types/database.types';

export interface EmployeeItem {
  user_id: string;
  login: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  color: string;
  created_at: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  inn: string | null;
  birth_date: string | null;
  gender: 'male' | 'female' | null;
  bio: string | null;
  telegram_username: string | null;
  telegram_linked: boolean;
}

/** Поля анкеты сотрудника (адрес, координаты, ИНН, дата рождения, пол, биография) */
export interface EmployeeProfileFields {
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  inn?: string | null;
  birth_date?: string | null;
  gender?: 'male' | 'female' | '' | null;
  bio?: string | null;
}

const PROFILE_FIELD_KEYS = ['address', 'latitude', 'longitude', 'inn', 'birth_date', 'gender', 'bio'] as const;

/** Переносит заданные (не undefined) поля анкеты из валидированного ввода в объект обновления */
function pickProfileFields(valid: Record<string, any>): Database['public']['Tables']['users']['Update'] {
  const updates: Record<string, any> = {};
  for (const key of PROFILE_FIELD_KEYS) {
    if (valid[key] !== undefined) updates[key] = valid[key];
  }
  return updates;
}

export interface GetEmployeesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  isActive?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface EmployeesResponse {
  employees: EmployeeItem[];
  totalCount: number;
  error?: string;
}

/**
 * Проверка прав администратора
 */
async function requireAdminAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Пользователь не авторизован');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role, full_name')
    .eq('auth_id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    throw new Error('Доступ разрешен только администраторам системы');
  }

  return { supabase, user, profile };
}

/** Понятные сообщения для ограничений анкеты (миграция 030) */
function friendlyProfileError(message: string): string {
  if (message.includes('users_inn_unique')) return 'Сотрудник с таким ИНН уже есть в системе';
  if (message.includes('users_inn_format')) return 'ИНН должен состоять из 14 цифр';
  if (message.includes('users_coordinates_pair')) return 'Укажите и широту, и долготу';
  if (message.includes('column') && /address|latitude|longitude|inn|birth_date|gender|bio/.test(message)) {
    return 'В базе нет полей анкеты сотрудника: примените миграцию 030_employee_profile_fields.sql';
  }
  return message;
}

/**
 * Кэшированная выборка сотрудников через unstable_cache
 */
const fetchCachedEmployees = unstable_cache(
  async (paramsKey: string) => {
    const params: GetEmployeesParams = JSON.parse(paramsKey);
    const supabase = createAdminClient();

    const {
      page = 1,
      pageSize = 1000,
      search = '',
      role,
      isActive,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = params;

    let query = supabase
      .from('users')
      .select(
        'user_id, login, full_name, phone, role, is_active, color, created_at, address, latitude, longitude, inn, birth_date, gender, bio, telegram_username, telegram_chat_id',
        {
          count: 'exact',
        }
      );

    // Поиск по ФИО, логину или телефону
    if (search.trim()) {
      const cleanSearch = search.trim();
      query = query.or(
        `full_name.ilike.%${cleanSearch}%,login.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`
      );
    }

    // Фильтр по роли
    if (role && role !== 'all') {
      query = query.eq('role', role as UserRole);
    }

    // Фильтр по статусу активности
    if (isActive === 'true') {
      query = query.eq('is_active', true);
    } else if (isActive === 'false') {
      query = query.eq('is_active', false);
    }

    // Сортировка
    const ascending = sortOrder === 'asc';
    const validSortCols = ['full_name', 'login', 'role', 'is_active', 'created_at'];
    const orderCol = validSortCols.includes(sortBy) ? sortBy : 'created_at';
    query = query.order(orderCol, { ascending });

    // Пагинация
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      console.error('Ошибка выборки сотрудников:', error);
      return { employees: [], totalCount: 0, error: error.message };
    }

    const employees: EmployeeItem[] = ((data || []) as any[]).map(({ telegram_chat_id, ...rest }) => ({
      ...rest,
      telegram_username: rest.telegram_username ?? null,
      telegram_linked: telegram_chat_id !== null && telegram_chat_id !== undefined,
    }));

    return {
      employees,
      totalCount: count || 0,
    };
  },
  ['employees-list'],
  { tags: ['employees'], revalidate: 300 }
);

/**
 * Получение списка сотрудников с пагинацией и фильтрацией
 */
export async function getEmployees(
  params: GetEmployeesParams = {}
): Promise<EmployeesResponse> {
  try {
    await requireAdminAuth();
    return await fetchCachedEmployees(JSON.stringify(params));
  } catch (err: any) {
    return { employees: [], totalCount: 0, error: err.message };
  }
}

export interface EmployeeMapPointData {
  user_id: string;
  full_name: string;
  login: string;
  role: UserRole;
  color: string | null;
  phone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
}

/**
 * Сотрудники для общей карты (администратор): активные с заданными координатами
 * и список имен тех, у кого место проживания не указано
 */
export async function getEmployeesForMap(): Promise<{
  points: EmployeeMapPointData[];
  withoutCoordinates: string[];
  error?: string;
}> {
  try {
    const { supabase } = await requireAdminAuth();
    const { data, error } = await supabase
      .from('users')
      .select('user_id, full_name, login, role, color, phone, address, latitude, longitude')
      .eq('is_active', true)
      .order('full_name');

    if (error) throw error;

    const points: EmployeeMapPointData[] = [];
    const withoutCoordinates: string[] = [];
    for (const u of data || []) {
      if (u.latitude !== null && u.longitude !== null) {
        points.push({
          user_id: u.user_id,
          full_name: u.full_name,
          login: u.login,
          role: u.role,
          color: u.color,
          phone: u.phone,
          address: u.address,
          latitude: Number(u.latitude),
          longitude: Number(u.longitude),
        });
      } else {
        withoutCoordinates.push(u.full_name);
      }
    }

    return { points, withoutCoordinates };
  } catch (err: any) {
    return { points: [], withoutCoordinates: [], error: err.message || 'Не удалось загрузить карту сотрудников' };
  }
}

/**
 * Добавление нового сотрудника
 */
export async function createEmployee(input: {
  login: string;
  password: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  color?: string;
} & EmployeeProfileFields): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    const { supabase } = await requireAdminAuth();

    const parsed = createEmployeeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Ошибка валидации полей' };
    }
    const valid = parsed.data;
    const cleanColor = valid.color && isValidHex(valid.color) ? normalizeHex(valid.color) : valid.color;

    const res = await createCrmUser({
      login: valid.login,
      password: valid.password,
      full_name: valid.full_name,
      phone: valid.phone || undefined,
      role: valid.role,
    });

    if (res.success && res.userId) {
      const extra: Database['public']['Tables']['users']['Update'] = pickProfileFields(valid);
      if (cleanColor) extra.color = cleanColor;
      if (Object.keys(extra).length > 0) {
        const { error: extraErr } = await supabase.from('users').update(extra).eq('user_id', res.userId);
        if (extraErr) {
          revalidateTag('employees');
          revalidatePath('/employees');
          return {
            success: false,
            userId: res.userId,
            error: `Сотрудник создан, но анкета не сохранена: ${friendlyProfileError(extraErr.message)}`,
          };
        }
      }
    }
    if (res.success) {
      revalidateTag('employees');
      revalidatePath('/employees');
      revalidatePath('/profile');
      revalidatePath('/leads');
      revalidatePath('/sellers');
    }
    return res;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Редактирование существующего сотрудника
 */
export async function updateEmployee(
  userId: string,
  input: {
    full_name?: string;
    phone?: string | null;
    role?: UserRole;
    is_active?: boolean;
    color?: string;
  } & EmployeeProfileFields
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdminAuth();

    const parsed = updateEmployeeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Ошибка валидации полей' };
    }
    const valid = parsed.data;

    const updates: Database['public']['Tables']['users']['Update'] = pickProfileFields(valid);
    if (valid.full_name !== undefined) {
      updates.full_name = valid.full_name.trim();
    }

    if (valid.phone !== undefined) {
      updates.phone = valid.phone?.trim() || null;
    }

    if (valid.role !== undefined) {
      updates.role = valid.role;
    }

    if (valid.is_active !== undefined) {
      updates.is_active = valid.is_active;
    }

    if (valid.color !== undefined) {
      updates.color = valid.color && isValidHex(valid.color) ? normalizeHex(valid.color) : (valid.color || '#3B82F6');
    }

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('user_id', userId)
      .select('auth_id, full_name, role')
      .single();

    if (updateError) {
      return { success: false, error: friendlyProfileError(updateError.message) };
    }

    // Синхронизация user_metadata в auth.users
    if (updated?.auth_id) {
      try {
        const adminClient = createAdminClient();
        await adminClient.auth.admin.updateUserById(updated.auth_id, {
          user_metadata: {
            full_name: updated.full_name,
            role: updated.role,
          },
        });
      } catch (metaErr) {
        console.warn('Предупреждение синхронизации auth_id:', metaErr);
      }
    }

    revalidateTag('employees');
    revalidatePath('/employees');
    revalidatePath('/profile');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Быстрое переключение активности (блокировка / разблокировка)
 */
export async function toggleEmployeeActive(
  userId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdminAuth();

    const { error } = await supabase
      .from('users')
      .update({ is_active: isActive })
      .eq('user_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidateTag('employees');
    revalidatePath('/employees');
    revalidatePath('/profile');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Административный сброс пароля сотрудника
 */
export async function resetEmployeePassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdminAuth();

    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Пароль должен содержать минимум 6 символов' };
    }

    const { data: targetUser, error: findError } = await supabase
      .from('users')
      .select('auth_id')
      .eq('user_id', userId)
      .single();

    if (findError || !targetUser?.auth_id) {
      return { success: false, error: 'Сотрудник не найден в системе' };
    }

    const adminClient = createAdminClient();
    const { error: authError } = await adminClient.auth.admin.updateUserById(
      targetUser.auth_id,
      { password: newPassword }
    );

    if (authError) {
      return { success: false, error: authError.message };
    }

    revalidateTag('employees');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
