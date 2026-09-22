'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { TopHeader } from '@/components/layout/TopHeader';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { MobileBottomBar } from '@/components/layout/MobileBottomBar';
import { FAB } from '@/components/layout/FAB';
import { useToast } from '@/components/ui/Toast';
import { useUser } from '@/components/auth/AuthProvider';
import { Plus } from 'lucide-react';
import type { UserRole } from '@/types/database.types';

interface AppLayoutProps {
  children: React.ReactNode;
  userRole?: UserRole;
  userName?: string;
  userLogin?: string;
  onSignOut?: () => void;
  onSyncApi?: () => void;
  isSyncing?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  filterCount?: number;
  filterContent?: React.ReactNode;
  onCreateClick?: () => void;
  createTooltip?: string;
  hideFab?: boolean;
}

export function AppLayout({
  children,
  userRole,
  userName,
  userLogin,
  onSignOut,
  onSyncApi,
  isSyncing = false,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  filterCount,
  filterContent,
  onCreateClick,
  createTooltip = 'Добавить',
  hideFab = false,
}: AppLayoutProps) {
  const pathname = usePathname();
  const { showToast } = useToast();
  const user = useUser();

  const effectiveRole = userRole || user.role;
  const effectiveName = userName || user.userName;
  const effectiveLogin = userLogin || user.userLogin;
  const effectiveSignOut = onSignOut || user.signOut;

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

  const canCreate = effectiveRole !== 'consultant';

  const handleFabClick = () => {
    if (!canCreate) return;
    if (onCreateClick) {
      onCreateClick();
    } else if (pathname === '/leads') {
      window.location.href = '/leads?action=create';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 selection:bg-zinc-900 selection:text-white dark:selection:bg-white dark:selection:text-zinc-900">
      {/* ДЕСКТОПНЫЙ СЛОЙ (экран >= 1024px) */}
      <DesktopSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        userRole={effectiveRole}
        userName={effectiveName}
        userLogin={effectiveLogin}
        onSignOut={effectiveSignOut}
      />

      <TopHeader
        collapsed={sidebarCollapsed}
        userRole={effectiveRole}
        userName={effectiveName}
        onSyncApi={handleSync}
        isSyncing={isSyncing || internalSyncing}
        lastSyncedAt={lastSyncedAt}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        filterCount={filterCount}
        filterContent={filterContent}
      />

      {/* МОБИЛЬНЫЙ СЛОЙ (экран < 1024px) */}
      <MobileHeader
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        filterCount={filterCount}
        filterContent={filterContent}
      />

      {/* ЦЕНТРАЛЬНАЯ СКРОЛЛИРУЕМАЯ ОБЛАСТЬ */}
      <main
        className={`transition-all duration-300 min-h-screen ${
          sidebarCollapsed ? 'lg:pl-24' : 'lg:pl-72'
        } lg:pt-24 lg:pr-6 lg:pb-8 pt-20 px-3 pb-44`}
      >
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>

      {/* УНИВЕРСАЛЬНАЯ КНОПКА ДОБАВЛЕНИЯ: */}
      {/* Мобильная кнопка FAB под большой палец правой руки */}
      {canCreate && (onCreateClick || pathname === '/leads') && !hideFab && (
        <FAB onClick={handleFabClick} label={createTooltip} />
      )}

      {/* Десктопная кнопка добавления в правом нижнем углу как аккуратный квадратик-островок */}
      {canCreate && onCreateClick && !hideFab && (
        <button
          type="button"
          onClick={onCreateClick}
          className="hidden lg:flex fixed bottom-8 right-8 z-40 w-12 h-12 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 shadow-xl items-center justify-center hover:scale-105 active:scale-95 transition-all duration-150 border border-white/20 dark:border-zinc-800/40 cursor-pointer island-interactive group"
          title={createTooltip}
          aria-label={createTooltip}
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
          <span className="sr-only">{createTooltip}</span>
        </button>
      )}

      <MobileBottomBar userRole={effectiveRole} />
    </div>
  );
}
