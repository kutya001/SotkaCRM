'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/database.types';

export interface AuthState {
  error?: string;
  success?: boolean;
}

export interface CreateUserInput {
  login: string;
  password: string;
  full_name: string;
  phone?: string;
  role: UserRole;
}

/**
 * Аутентификация сотрудника по логину и паролю.
 * Внутренний email инкапсулирован через синтетический домен @internal.sotka.kg.
 */
export async function login(prevState: AuthState, formData: FormData): Promise<AuthState> {
  const loginInput = (formData.get('login') || formData.get('identifier') || formData.get('email')) as string;
  const password = formData.get('password') as string;

  if (!loginInput || !password) {
    return { error: 'Пожалуйста, заполните логин и пароль.' };
  }

  const cleanLogin = loginInput.trim().toLowerCase().replace(/^@/, '').replace(/@internal\.sotka\.kg$/, '');
  let shouldRedirect = false;

  try {
    const supabase = await createClient();

    // 1. Формирование синтетического email для Supabase Auth
    const syntheticEmail = `${cleanLogin}@internal.sotka.kg`;

    // 2. Аутентификация через Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: syntheticEmail,
      password,
    });

    if (authError || !authData.user) {
      // Проверяем, существует ли логин в системе для информативного сообщения
      const { data: existingUser, error: existError } = await supabase
        .from('users')
        .select('user_id')
        .ilike('login', cleanLogin)
        .maybeSingle();

      if (!existingUser) {
        const keyVal = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const keyPreview = `${keyVal.slice(0, 10)}...${keyVal.slice(-10)} (len ${keyVal.length})`;
        return { 
          error: `Пользователь с таким логином не найден в системе. [auth: ${authError?.message || 'null'}; db: ${existError?.message || 'null'}; key: ${keyPreview}]` 
        };
      }
      return { error: 'Неверный логин или пароль.' };
    }

    // 3. Извлечение профиля сотрудника
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('user_id, auth_id, login, role, is_active')
      .eq('auth_id', authData.user.id)
      .single();

    if (profileError || !userProfile) {
      await supabase.auth.signOut();
      return { error: 'Профиль сотрудника не найден в системе CRM.' };
    }

    // 4. Проверка флага активности
    if (!userProfile.is_active) {
      await supabase.auth.signOut();
      return { error: 'Учетная запись отключена или заблокирована администратором.' };
    }

    shouldRedirect = true;
  } catch (err: unknown) {
    if (isRedirectError(err)) {
      throw err;
    }
    console.error('Ошибка аутентификации:', err);
    return { error: 'Ошибка сервера при авторизации. Попробуйте еще раз.' };
  }

  if (shouldRedirect) {
    revalidatePath('/', 'layout');
    redirect('/');
  }

  return {};
}

/**
 * Выход из системы
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

/**
 * Создание учетной записи нового сотрудника (строго для роли admin).
 * Выполняется без запроса email у пользователя, связывая логин с auth.users.
 */
export async function createCrmUser(
  input: CreateUserInput
): Promise<{ success: boolean; userId?: string; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Пользователь не аутентифицирован' };
  }

  // Проверка роли текущего пользователя
  const { data: currentProfile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_id', user.id)
    .single();

  if (!currentProfile || currentProfile.role !== 'admin') {
    return { success: false, error: 'Создание пользователей доступно только администратору' };
  }

  if (!input.login || input.login.trim().length < 3) {
    return { success: false, error: 'Логин должен содержать не менее 3 символов' };
  }

  if (!input.password || input.password.length < 6) {
    return { success: false, error: 'Пароль должен содержать не менее 6 символов' };
  }

  if (!input.full_name || input.full_name.trim().length < 2) {
    return { success: false, error: 'Укажите полное ФИО сотрудника' };
  }

  // Вызов функции базы данных create_crm_user со статусом SECURITY DEFINER
  const { data: createdUserId, error: rpcError } = await supabase.rpc('create_crm_user', {
    p_login: input.login.trim(),
    p_password: input.password,
    p_full_name: input.full_name.trim(),
    p_phone: input.phone?.trim() || null,
    p_role: input.role,
  });

  if (rpcError) {
    return { success: false, error: rpcError.message };
  }

  revalidatePath('/', 'layout');
  return { success: true, userId: createdUserId };
}
