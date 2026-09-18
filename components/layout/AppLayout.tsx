'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { TopHeader } from '@/components/layout/TopHeader';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { MobileBottomBar } from '@/components/layout/MobileBottomBar';
import { FAB } from '@/components/layout/FAB';
import type { UserRole } from '@/types/database.types';

interface AppLayoutProps {
  children: React.ReactNode;
  userRole?: UserRole;
  userName?: string;
  userLogin?: string;
  onSignOut?: () => void;
  onSyncApi?: () => void;
  isSyncing?: boolean;
}

export function AppLayout({
  children,
  userRole = 'admin',
  userName = 'Администратор',
  userLogin = 'admin',
  onSignOut,
  onSyncApi,
  isSyncing = false,
}: AppLayoutProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  // На странице логина отображаем чистый контейнер без интерфейсных островков
  if (pathname === '/login') {
    return <>{children}</>;
  }

  const handleFabClick = () => {
    // В этапе 2 здесь будет вызов шторки быстрого создания лида
    window.location.href = '/leads?action=create';
  };

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 selection:bg-zinc-900 selection:text-white dark:selection:bg-white dark:selection:text-zinc-900">
      {/* ДЕСКТОПНЫЙ СЛОЙ (экран >= 1024px) */}
      <DesktopSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        userRole={userRole}
        userName={userName}
        userLogin={userLogin}
        onSignOut={onSignOut}
      />

      <TopHeader
        collapsed={sidebarCollapsed}
        userRole={userRole}
        userName={userName}
        onSyncApi={onSyncApi}
        isSyncing={isSyncing}
      />

      {/* МОБИЛЬНЫЙ СЛОЙ (экран < 1024px) */}
      <MobileHeader />

      {/* ЦЕНТРАЛЬНАЯ СКРОЛЛИРУЕМАЯ ОБЛАСТЬ */}
      <main
        className={`transition-all duration-300 min-h-screen ${
          // Отступы для десктопа: слева сайдбар (288px / 96px), сверху header (96px)
          sidebarCollapsed ? 'lg:pl-24' : 'lg:pl-72'
        } lg:pt-24 lg:pr-6 lg:pb-8 pt-20 px-3 pb-44`}
      >
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>

      {/* МОБИЛЬНЫЕ ЭЛЕМЕНТЫ УПРАВЛЕНИЯ */}
      <FAB onClick={handleFabClick} label="Добавить новый лид" />
      <MobileBottomBar userRole={userRole} />
    </div>
  );
}
