'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePermission } from '@/lib/auth/check-role';
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
  /** Базовый профиль (устаревший enum); при наличии role_id enum выводится триггером из роли */
  role: UserRole;
  /** Назначенная роль (roles.role_id) */
  role_id?: string;
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
      if (authError?.message?.toLowerCase().includes('api key')) {
        return {
          error: 'Ошибка конфигурации: недействительный API-ключ Supabase (NEXT_PUBLIC_SUPABASE_ANON_KEY). Проверьте Environment Variables на Vercel.',
        };
      }

      // Заблокированные сотрудники забанены в GoTrue (миграция 029)
      if (authError?.message?.toLowerCase().includes('banned')) {
        return { error: 'Учетная запись отключена или заблокирована администратором.' };
      }

      // Единое сообщение: не раскрываем, существует ли логин
      return { error: 'Неверный логин или пароль.' };
    }

    // 3. Извлечение профиля сотрудника
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('user_id, auth_id, login, full_name, role, is_active')
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

    const cookieStore = await cookies();
    cookieStore.set('crm_role', userProfile.role, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    cookieStore.set('crm_active', userProfile.is_active ? 'true' : 'false', { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    cookieStore.set('crm_user_name', encodeURIComponent(userProfile.full_name || 'Сотрудник CRM'), { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    cookieStore.set('crm_user_login', userProfile.login, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    cookieStore.set('crm_user_id', userProfile.user_id, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });

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
  const cookieStore = await cookies();
  cookieStore.delete('crm_role');
  cookieStore.delete('crm_active');
  cookieStore.delete('crm_user_name');
  cookieStore.delete('crm_user_login');
  cookieStore.delete('crm_user_id');
  revalidatePath('/', 'layout');
  redirect('/login');
}

/**
 * Создание учетной записи нового сотрудника (право employees.create).
 * Выполняется без запроса email у пользователя, связывая логин с auth.users.
 */
export async function createCrmUser(
  input: CreateUserInput
): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    await requirePermission('employees.create');
  } catch (err: any) {
    return { success: false, error: err?.message || 'Недостаточно прав для создания сотрудников' };
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

  // create_crm_user (SECURITY DEFINER) доступна только service_role — право employees.create проверено выше
  const adminClient = createAdminClient();
  const { data: createdUserId, error: rpcError } = await adminClient.rpc('create_crm_user', {
    p_login: input.login.trim(),
    p_password: input.password,
    p_full_name: input.full_name.trim(),
    p_phone: input.phone?.trim() || undefined,
    p_role: input.role,
  });

  if (rpcError) {
    return { success: false, error: rpcError.message };
  }

  // Назначенная роль: RPC знает только устаревший enum, role_id проставляем отдельно
  // (триггер trg_users_sync_role синхронизирует enum с base_role роли)
  if (input.role_id && createdUserId) {
    const { error: roleErr } = await adminClient
      .from('users')
      .update({ role_id: input.role_id })
      .eq('user_id', createdUserId);
    if (roleErr) {
      revalidatePath('/', 'layout');
      return {
        success: false,
        userId: createdUserId,
        error: `Сотрудник создан, но роль не назначена: ${roleErr.message}`,
      };
    }
  }

  revalidatePath('/', 'layout');
  return { success: true, userId: createdUserId };
}
