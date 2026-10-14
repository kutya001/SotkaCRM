'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, LogOut, ShieldAlert, ShieldCheck, Shield, User, LayoutGrid } from 'lucide-react';
import { useUser } from '@/components/auth/AuthProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { UserRole } from '@/types/database.types';
import { NAV_ITEMS } from '@/lib/navigation';
import { ROLE_LABELS } from '@/lib/constants/roles';
import { useBottomBarItems } from '@/components/layout/MobileBottomBar';
import { useModalBehavior } from '@/components/ui/Modal';

interface MobileMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Мобильное меню «остальные разделы»: выдвигающаяся снизу панель (bottom sheet).
 * Показывает модули, которых нет в нижней панели, карточку пользователя, тему и выход.
 */
export function MobileMenuDrawer({ isOpen, onClose }: MobileMenuDrawerProps) {
  const pathname = usePathname();
  const user = useUser();
  const effectiveRole = user.role || 'consultant';
  const bottomBarItems = useBottomBarItems();

  useModalBehavior(isOpen, onClose);

  // Разделы меню — по праву «видеть в меню» назначенной роли, без тех, что уже в нижней панели
  const navItems = React.useMemo(() => {
    const inBar = new Set(bottomBarItems.map((i) => i.href));
    return NAV_ITEMS.filter((item) => user.can(item.permission) && !inBar.has(item.href));
  }, [bottomBarItems, user]);
  const showProfile = !bottomBarItems.some((i) => i.href === '/profile');

  const RoleIcon: Record<UserRole, React.ElementType> = {
    admin: ShieldAlert,
    supervisor: ShieldAlert,
    consultant: ShieldCheck,
    smm: Shield,
  };

  const currentRoleLabel = user.roleName || ROLE_LABELS[effectiveRole] || 'Сотрудник';
  const CurrentRoleIcon = user.isAdmin ? ShieldAlert : RoleIcon[effectiveRole] || ShieldCheck;

  // Свайп вниз закрывает панель
  const panelRef = React.useRef<HTMLDivElement>(null);
  const swipe = React.useRef({ startY: 0, dy: 0, active: false });
  const onTouchStart = (e: React.TouchEvent) => {
    swipe.current = { startY: e.touches[0].clientY, dy: 0, active: true };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!swipe.current.active || !panelRef.current) return;
    const dy = Math.max(0, e.touches[0].clientY - swipe.current.startY);
    swipe.current.dy = dy;
    panelRef.current.style.transform = `translateY(${dy}px)`;
    panelRef.current.style.transition = 'none';
  };
  const onTouchEnd = () => {
    if (!swipe.current.active || !panelRef.current) return;
    const { dy } = swipe.current;
    swipe.current.active = false;
    panelRef.current.style.transition = '';
    panelRef.current.style.transform = '';
    if (dy > 80) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="lg:hidden fixed inset-0 z-[70] flex flex-col justify-end animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Все разделы"
    >
      {/* Матовая подложка */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Выдвигающаяся снизу панель */}
      <div
        ref={panelRef}
        className="relative z-10 w-full max-h-[85vh] flex flex-col rounded-t-3xl bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in slide-in-from-bottom duration-200 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {/* Ручка и шапка (свайп вниз закрывает) */}
        <div
          className="flex-shrink-0 pt-2 px-4 pb-3 border-b border-zinc-200/60 dark:border-zinc-800/60"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="mx-auto w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 mb-3" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center flex-shrink-0">
                {user.userName ? user.userName.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {user.userName || 'Пользователь'}
                </p>
                <div className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <CurrentRoleIcon className="w-3 h-3 text-blue-500" strokeWidth={2} />
                  <span className="truncate">{currentRoleLabel}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Закрыть меню"
            >
              <X className="w-5 h-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Остальные модули — сеткой плиток */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-3">
            <LayoutGrid className="w-3.5 h-3.5" strokeWidth={2} />
            Остальные разделы
          </div>
          {navItems.length === 0 && !showProfile ? (
            <p className="text-xs text-zinc-400 py-6 text-center">Все доступные разделы уже в нижней панели</p>
          ) : (
            <nav className="grid grid-cols-3 gap-2.5">
              {navItems.map((item) => {
                const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`flex flex-col items-center justify-center gap-2 h-[84px] rounded-2xl border text-center px-2 transition-all active:scale-95 ${
                      isActive
                        ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white shadow-sm'
                        : 'bg-zinc-100/70 dark:bg-zinc-800/50 border-zinc-200/60 dark:border-zinc-700/40 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
                    <span className="text-[11px] font-semibold leading-tight line-clamp-2">{item.title}</span>
                  </Link>
                );
              })}
              {showProfile && (
                <Link
                  href="/profile"
                  onClick={onClose}
                  className={`flex flex-col items-center justify-center gap-2 h-[84px] rounded-2xl border text-center px-2 transition-all active:scale-95 ${
                    pathname.startsWith('/profile')
                      ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white shadow-sm'
                      : 'bg-zinc-100/70 dark:bg-zinc-800/50 border-zinc-200/60 dark:border-zinc-700/40 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <User className="w-5 h-5" strokeWidth={1.75} />
                  <span className="text-[11px] font-semibold leading-tight">Профиль</span>
                </Link>
              )}
            </nav>
          )}
        </div>

        {/* Подвал: тема и выход */}
        <div className="flex-shrink-0 px-4 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="text-[11px] text-zinc-400 font-medium">Тема оформления</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              user.signOut();
            }}
            className="h-10 px-3 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors flex items-center gap-2 text-xs font-semibold"
            title="Выйти из системы"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
