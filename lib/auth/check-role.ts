import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, UserRole } from '@/types/database.types';

export interface AuthContext {
  user: {
    id: string;
    email?: string;
  };
  profile: {
    user_id: string;
    auth_id: string;
    login: string;
    full_name: string;
    role: UserRole;
    is_active: boolean;
  };
  supabase: SupabaseClient<Database>;
}

/**
 * Валидация активной сессии пользователя и извлечение профиля из БД.
 * Мемоизировано через React.cache() на время жизненного цикла HTTP-запроса,
 * исключая дублирующие обращения к Auth API и таблице users при множественных экшенах.
 */
export const requireAuth = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Пользователь не авторизован');
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('user_id, auth_id, login, full_name, role, is_active')
    .eq('auth_id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Профиль пользователя не найден в системе CRM');
  }

  if (!profile.is_active) {
    throw new Error('Учетная запись заблокирована или отключена администратором');
  }

  return {
    user: { id: user.id, email: user.email },
    profile: profile as AuthContext['profile'],
    supabase,
  };
});

/**
 * Проверка прав роли администратора (строго admin).
 */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireAuth();

  if (ctx.profile.role !== 'admin') {
    throw new Error('Недостаточно прав. Операция разрешена исключительно администраторам.');
  }

  return ctx;
}

/**
 * Проверка разрешенных ролей (RBAC).
 */
export async function requireRoles(allowedRoles: UserRole[]): Promise<AuthContext> {
  const ctx = await requireAuth();

  if (!allowedRoles.includes(ctx.profile.role)) {
    throw new Error(
      `Недостаточно прав. Действие доступно для ролей: ${allowedRoles.join(', ')}.`
    );
  }

  return ctx;
}
