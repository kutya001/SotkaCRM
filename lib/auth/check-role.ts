import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, UserRole } from '@/types/database.types';
import { hasAllPermissions, hasAnyPermission, hasPermission, legacyPermissionsForRole } from '@/lib/auth/permissions';
import { PERMISSION_LABELS } from '@/lib/auth/permissions-catalog';

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
    /** Базовый профиль (устаревший enum): используется RLS и статистическими RPC */
    role: UserRole;
    is_active: boolean;
    role_id: string | null;
    role_code: string | null;
    role_name: string;
  };
  /** Права назначенной роли; «*» — полный доступ */
  permissions: string[];
  /** Роль с полным доступом (is_admin) */
  isAdmin: boolean;
  can: (key: string) => boolean;
  canAny: (keys: string[]) => boolean;
  /** Видит ли все записи модуля (право «<модуль>.view_all») */
  canViewAll: (module: string) => boolean;
  supabase: SupabaseClient<Database>;
}

export class PermissionError extends Error {
  code = 'FORBIDDEN';
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

interface RoleJoin {
  code: string;
  name: string;
  is_admin: boolean;
  base_role: UserRole;
  role_permissions: { permission: string }[] | null;
}

/**
 * Валидация активной сессии пользователя, извлечение профиля и прав роли из БД.
 * Мемоизировано через React.cache() на время жизненного цикла HTTP-запроса,
 * исключая дублирующие обращения к Auth API и таблицам при множественных экшенах.
 */
export const requireAuth = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();

  // getClaims проверяет подпись JWT локально (JWKS кэшируется) — без сетевого запроса
  // к Supabase Auth на каждый вызов API, в отличие от getUser
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (authError || !claims?.sub) {
    throw new Error('Пользователь не авторизован');
  }

  // Роль, права и is_active всегда читаются из БД: JWT не отражает блокировку и смену роли
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(
      'user_id, auth_id, login, full_name, role, is_active, role_id, roles:role_id(code, name, is_admin, base_role, role_permissions(permission))'
    )
    .eq('auth_id', claims.sub)
    .single();

  if (profileError || !profile) {
    throw new Error('Профиль пользователя не найден в системе CRM');
  }

  if (!profile.is_active) {
    throw new Error('Учетная запись заблокирована или отключена администратором');
  }

  const roleJoin = (profile as unknown as { roles: RoleJoin | RoleJoin[] | null }).roles;
  const role: RoleJoin | null = Array.isArray(roleJoin) ? roleJoin[0] || null : roleJoin;

  // Запасной режим: роль не назначена (миграция 040 не применена или новый сотрудник) — права по enum
  const permissions = role
    ? role.is_admin
      ? ['*']
      : (role.role_permissions || []).map((p) => p.permission)
    : legacyPermissionsForRole(profile.role as UserRole);
  const isAdmin = permissions.includes('*');

  return {
    user: { id: claims.sub, email: claims.email },
    profile: {
      user_id: profile.user_id,
      auth_id: profile.auth_id as string,
      login: profile.login,
      full_name: profile.full_name,
      role: profile.role as UserRole,
      is_active: profile.is_active,
      role_id: profile.role_id ?? null,
      role_code: role?.code ?? null,
      role_name: role?.name ?? '',
    },
    permissions,
    isAdmin,
    can: (key) => hasPermission(permissions, key),
    canAny: (keys) => hasAnyPermission(permissions, keys),
    canViewAll: (module) => hasPermission(permissions, `${module}.view_all`),
    supabase,
  };
});

function describe(keys: string[]): string {
  return keys.map((k) => PERMISSION_LABELS[k] || k).join('; ');
}

/**
 * Проверка права (или всех перечисленных прав) назначенной роли.
 */
export async function requirePermission(key: string | string[]): Promise<AuthContext> {
  const ctx = await requireAuth();
  const keys = Array.isArray(key) ? key : [key];
  if (!hasAllPermissions(ctx.permissions, keys)) {
    throw new PermissionError(`Недостаточно прав. Требуется: ${describe(keys)}.`);
  }
  return ctx;
}

/**
 * Проверка хотя бы одного из прав.
 */
export async function requireAnyPermission(keys: string[]): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!hasAnyPermission(ctx.permissions, keys)) {
    throw new PermissionError(`Недостаточно прав. Требуется одно из: ${describe(keys)}.`);
  }
  return ctx;
}

/**
 * Проверка роли с полным доступом (Администратор): служебные операции вне каталога прав.
 */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireAuth();

  if (!ctx.isAdmin) {
    throw new PermissionError('Недостаточно прав. Операция разрешена исключительно администраторам.');
  }

  return ctx;
}
