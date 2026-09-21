'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCrmUser } from '@/app/auth/actions';
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

/**
 * Получение списка сотрудников с пагинацией и фильтрацией
 */
export async function getEmployees(
  params: GetEmployeesParams = {}
): Promise<EmployeesResponse> {
  try {
    const { supabase } = await requireAdminAuth();

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
      .select('user_id, login, full_name, phone, role, is_active, color, created_at', {
        count: 'exact',
      });

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

    return {
      employees: (data as EmployeeItem[]) || [],
      totalCount: count || 0,
    };
  } catch (err: any) {
    return { employees: [], totalCount: 0, error: err.message };
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
}): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    const { supabase } = await requireAdminAuth();
    const res = await createCrmUser(input);
    if (res.success && res.userId && input.color) {
      await supabase
        .from('users')
        .update({ color: input.color })
        .eq('user_id', res.userId);
    }
    if (res.success) {
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
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdminAuth();

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

    if (input.role !== undefined) {
      updates.role = input.role;
    }

    if (input.is_active !== undefined) {
      updates.is_active = input.is_active;
    }

    if (input.color !== undefined) {
      updates.color = input.color;
    }

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('user_id', userId)
      .select('auth_id, full_name, role')
      .single();

    if (updateError) {
      return { success: false, error: updateError.message };
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

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
