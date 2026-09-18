'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { TopHeader } from '@/components/layout/TopHeader';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { MobileBottomBar } from '@/components/layout/MobileBottomBar';
import { FAB } from '@/components/layout/FAB';
import { useToast } from '@/components/ui/Toast';
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
  const { showToast } = useToast();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [internalSyncing, setInternalSyncing] = React.useState(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('crm_last_sotka_sync');
      if (saved) setLastSyncedAt(saved);
    } catch {}
  }, []);

  const handleSync = async () => {
    if (onSyncApi) {
      onSyncApi();
      return;
    }
    if (isSyncing || internalSyncing) return;
    setInternalSyncing(true);
    try {
      const res = await fetch('/api/sync/sotka', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка синхронизации');
      }
      const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      setLastSyncedAt(timeStr);
      try {
        localStorage.setItem('crm_last_sotka_sync', timeStr);
      } catch {}
      showToast(
        `Синхронизация завершена: ${data.syncedSellers} продавцов, ${data.syncedPayments} платежей`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message || 'Сбой при обращении к API Sotka', 'error');
    } finally {
      setInternalSyncing(false);
    }
  };

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
        onSyncApi={handleSync}
        isSyncing={isSyncing || internalSyncing}
        lastSyncedAt={lastSyncedAt}
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
