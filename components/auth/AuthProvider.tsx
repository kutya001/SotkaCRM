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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [role, setRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState<string>('Сотрудник CRM');
  const [userLogin, setUserLogin] = React.useState<string>('user');
  const [isLoading, setIsLoading] = React.useState(true);

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
          setIsLoading(false);
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
