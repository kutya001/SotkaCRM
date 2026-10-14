'use client';

import * as React from 'react';
import { useAppShell, type ShellPageConfig } from '@/components/layout/AppShell';
import type { UserRole } from '@/types/database.types';

interface AppLayoutProps extends ShellPageConfig {
  children: React.ReactNode;
  /** @deprecated роль, имя и логин оболочка берет из AuthProvider */
  userRole?: UserRole;
  /** @deprecated */
  userName?: string;
  /** @deprecated */
  userLogin?: string;
  /** @deprecated */
  onSignOut?: () => void;
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Регистратор параметров страницы для постоянной оболочки AppShell (корневой layout):
 * поиск, фильтры и кнопка создания. Сам интерфейс (сайдбар, шапки,
 * нижняя панель) больше не монтируется страницей — поэтому не мерцает при переходах.
 */
export function AppLayout({
  children,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  filterCount,
  filterContent,
  onCreateClick,
  createTooltip,
  hideFab,
}: AppLayoutProps) {
  const shell = useAppShell();

  useIsomorphicLayoutEffect(() => {
    if (!shell) return;
    shell.setPageConfig({
      searchQuery,
      onSearchChange,
      searchPlaceholder,
      filterCount,
      filterContent,
      onCreateClick,
      createTooltip,
      hideFab,
    });
  }, [
    shell,
    searchQuery,
    onSearchChange,
    searchPlaceholder,
    filterCount,
    filterContent,
    onCreateClick,
    createTooltip,
    hideFab,
  ]);

  useIsomorphicLayoutEffect(() => {
    if (!shell) return;
    return () => shell.setPageConfig(null);
  }, [shell]);

  return <>{children}</>;
}
