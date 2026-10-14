'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/types/database.types';
import { hasPermission, legacyPermissionsForRole } from '@/lib/auth/permissions';

export interface UserProfile {
  user_id: string;
  auth_id: string | null;
  login: string;
  full_name: string;
  /** Базовый профиль (устаревший enum) */
  role: UserRole;
  role_id?: string | null;
  role_code?: string | null;
  role_name?: string | null;
  is_admin?: boolean;
  /** Права назначенной роли; «*» — полный доступ */
  permissions?: string[];
  phone?: string | null;
  is_active: boolean;
}

interface UserContextValue {
  profile: UserProfile | null;
  role: UserRole;
  /** Название назначенной роли для отображения */
  roleName: string;
  userName: string;
  userLogin: string;
  /** Права текущего сотрудника («*» — полный доступ) */
  permissions: string[];
  /** Роль с полным доступом */
  isAdmin: boolean;
  /** Проверка права из каталога lib/auth/permissions-catalog.ts */
  can: (key: string) => boolean;
  /** Видит ли все записи модуля */
  canViewAll: (module: string) => boolean;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const STORAGE_KEY = 'sotka_user_profile';

const UserContext = React.createContext<UserContextValue>({
  profile: null,
  role: 'consultant',
  roleName: '',
  userName: 'Сотрудник CRM',
  userLogin: 'user',
  permissions: [],
  isAdmin: false,
  can: () => false,
  canViewAll: () => false,
  isLoading: true,
  refreshUser: async () => {},
  signOut: async () => {},
});

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

const KNOWN_ROLES: UserRole[] = ['admin', 'consultant', 'smm', 'supervisor'];

// useLayoutEffect на клиенте (до отрисовки кадра), без предупреждений при SSR
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export function AuthProvider({ children }: AuthProviderProps) {
  // Начальное состояние одинаково на сервере и клиенте (страницы статические, без cookies на сервере),
  // кэшированный профиль подставляется до первой отрисовки в layout-эффекте ниже
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [role, setRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState<string>('Сотрудник CRM');
  const [userLogin, setUserLogin] = React.useState<string>('user');
  const [isLoading, setIsLoading] = React.useState(false);
  // Пока профиль с правами не загружен — запасной набор по базовому профилю
  const [permissions, setPermissions] = React.useState<string[] | null>(null);

  const applyProfile = React.useCallback((p: UserProfile) => {
    setProfile(p);
    setRole(p.role);
    setUserName(p.full_name || 'Сотрудник CRM');
    setUserLogin(p.login || 'user');
    setPermissions(p.permissions ? [...p.permissions] : null);
  }, []);

  useIsomorphicLayoutEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as UserProfile;
        if (parsed && KNOWN_ROLES.includes(parsed.role)) {
          applyProfile(parsed);
          return;
        }
      }
    } catch {}

    const cookieRole = getCookie('crm_role');
    if (cookieRole && KNOWN_ROLES.includes(cookieRole as UserRole)) {
      setRole(cookieRole as UserRole);
    }
    const cookieName = getCookie('crm_user_name');
    if (cookieName) setUserName(cookieName);
    const cookieLogin = getCookie('crm_user_login');
    if (cookieLogin) setUserLogin(cookieLogin);
  }, [applyProfile]);

  const refreshUser = React.useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfile(null);
        setPermissions(null);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        return;
      }

      // Профиль вместе с правами роли отдает API (права считаются на сервере)
      const res = await fetch('/api/v1/auth/me', { cache: 'no-store', credentials: 'include' });
      if (res.ok) {
        const me = (await res.json()) as {
          id: string;
          auth_id: string;
          login: string;
          full_name: string;
          role: UserRole;
          role_id: string | null;
          role_code: string | null;
          role_name: string;
          is_admin: boolean;
          is_active: boolean;
          permissions: string[];
        };
        const userProf: UserProfile = {
          user_id: me.id,
          auth_id: me.auth_id,
          login: me.login,
          full_name: me.full_name,
          role: me.role,
          role_id: me.role_id,
          role_code: me.role_code,
          role_name: me.role_name,
          is_admin: me.is_admin,
          permissions: me.permissions,
          is_active: me.is_active,
        };
        applyProfile(userProf);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(userProf));
        } catch {}
        return;
      }

      // Запасной путь (API недоступен): профиль напрямую из таблицы users, права — по базовому профилю
      const { data: dbProfile, error } = await supabase
        .from('users')
        .select('user_id, auth_id, login, full_name, role, phone, is_active')
        .eq('auth_id', user.id)
        .single();

      if (!error && dbProfile) {
        applyProfile({
          user_id: dbProfile.user_id,
          auth_id: dbProfile.auth_id,
          login: dbProfile.login,
          full_name: dbProfile.full_name,
          role: dbProfile.role as UserRole,
          phone: dbProfile.phone,
          is_active: dbProfile.is_active,
        });
      }
    } catch (err) {
      console.warn('[AuthProvider] Ошибка верификации сессии:', err);
    } finally {
      setIsLoading(false);
    }
  }, [applyProfile]);

  React.useEffect(() => {
    refreshUser();

    // Слушатель смены состояния авторизации
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        refreshUser();
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        setRole('consultant');
        setUserName('Сотрудник CRM');
        setUserLogin('user');
        setPermissions(null);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshUser]);

  // Вход выполняется серверным экшеном с клиентской навигацией (без перезагрузки страницы):
  // браузерный клиент не получает SIGNED_IN, поэтому подтягиваем профиль при уходе со /login
  const pathname = usePathname();
  const prevPathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    // Первый рендер покрыт refreshUser() при монтировании
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    if (!profile && pathname && !pathname.startsWith('/login')) {
      refreshUser();
    }
  }, [pathname, profile, refreshUser]);

  const signOut = React.useCallback(async () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
  }, []);

  const effectivePermissions = React.useMemo(
    () => permissions ?? legacyPermissionsForRole(role),
    [permissions, role]
  );

  const value = React.useMemo<UserContextValue>(
    () => ({
      profile,
      role,
      roleName: profile?.role_name || '',
      userName,
      userLogin,
      permissions: effectivePermissions,
      isAdmin: effectivePermissions.includes('*'),
      can: (key: string) => hasPermission(effectivePermissions, key),
      canViewAll: (module: string) => hasPermission(effectivePermissions, `${module}.view_all`),
      isLoading,
      refreshUser,
      signOut,
    }),
    [profile, role, userName, userLogin, effectivePermissions, isLoading, refreshUser, signOut]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return React.useContext(UserContext);
}
