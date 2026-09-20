'use client';

import * as React from 'react';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/types/database.types';

export interface UserProfile {
  user_id: string;
  auth_id: string | null;
  login: string;
  full_name: string;
  role: UserRole;
  phone?: string | null;
  is_active: boolean;
}

interface UserContextValue {
  profile: UserProfile | null;
  role: UserRole;
  userName: string;
  userLogin: string;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const STORAGE_KEY = 'sotka_user_profile';

const UserContext = React.createContext<UserContextValue>({
  profile: null,
  role: 'consultant',
  userName: 'Сотрудник CRM',
  userLogin: 'user',
  isLoading: true,
  refreshUser: async () => {},
  signOut: async () => {},
});

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = React.useState<UserProfile | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) return JSON.parse(cached) as UserProfile;
    } catch {}
    return null;
  });

  const [role, setRole] = React.useState<UserRole>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.role) return parsed.role as UserRole;
        }
      } catch {}
      const fromCookie = getCookie('crm_role');
      if (fromCookie && ['admin', 'consultant', 'smm'].includes(fromCookie)) {
        return fromCookie as UserRole;
      }
    }
    return 'admin';
  });

  const [userName, setUserName] = React.useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.full_name) return parsed.full_name;
        }
      } catch {}
      const fromCookie = getCookie('crm_user_name');
      if (fromCookie) return fromCookie;
    }
    return 'Сотрудник CRM';
  });

  const [userLogin, setUserLogin] = React.useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.login) return parsed.login;
        }
      } catch {}
      const fromCookie = getCookie('crm_user_login');
      if (fromCookie) return fromCookie;
    }
    return 'user';
  });

  const [isLoading, setIsLoading] = React.useState(false);

  // Синхронная инициализация из localStorage на первом кадре для 0ms задержки
  React.useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as UserProfile;
        if (parsed && parsed.role) {
          setProfile(parsed);
          setRole(parsed.role);
          setUserName(parsed.full_name || 'Сотрудник CRM');
          setUserLogin(parsed.login || 'user');
        }
      }
    } catch {}
  }, []);

  const refreshUser = React.useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfile(null);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        return;
      }

      const { data: dbProfile, error } = await supabase
        .from('users')
        .select('user_id, auth_id, login, full_name, role, phone, is_active')
        .eq('auth_id', user.id)
        .single();

      if (!error && dbProfile) {
        const userProf: UserProfile = {
          user_id: dbProfile.user_id,
          auth_id: dbProfile.auth_id,
          login: dbProfile.login,
          full_name: dbProfile.full_name,
          role: dbProfile.role as UserRole,
          phone: dbProfile.phone,
          is_active: dbProfile.is_active,
        };

        setProfile(userProf);
        setRole(userProf.role);
        setUserName(userProf.full_name || 'Сотрудник CRM');
        setUserLogin(userProf.login || 'user');

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(userProf));
        } catch {}
      }
    } catch (err) {
      console.warn('[AuthProvider] Ошибка верификации сессии:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshUser]);

  const signOut = React.useCallback(async () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
  }, []);

  const value = React.useMemo<UserContextValue>(
    () => ({
      profile,
      role,
      userName,
      userLogin,
      isLoading,
      refreshUser,
      signOut,
    }),
    [profile, role, userName, userLogin, isLoading, refreshUser, signOut]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return React.useContext(UserContext);
}
