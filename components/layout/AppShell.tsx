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

/**
 * Постоянная оболочка приложения: сайдбар, шапки, область контента, FAB и нижняя панель
 * монтируются один раз в корневом layout и не перемонтируются при переходах между модулями.
 *
 * Свернутость сайдбара и ширина контента хранятся атрибутами на <html>
 * (data-sidebar / data-layout), которые инлайн-скрипт в layout выставляет до первой
 * отрисовки, а CSS-переменные в globals.css задают ширины — без мерцания и анимации
 * «раскрыт → свернут» при загрузке страницы. Переходы включаются только после
 * монтирования (data-shell-ready).
 *
 * Страницы регистрируют свои параметры шапки (поиск, фильтры, кнопка создания)
 * через <AppLayout> — тонкий регистратор, пишущий в контекст оболочки.
 */

export interface ShellPageConfig {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  filterCount?: number;
  filterContent?: React.ReactNode;
  onCreateClick?: () => void;
  createTooltip?: string;
  hideFab?: boolean;
}

interface AppShellContextValue {
  setPageConfig: (config: ShellPageConfig | null) => void;
}

const AppShellContext = React.createContext<AppShellContextValue | null>(null);

export function useAppShell(): AppShellContextValue | null {
  return React.useContext(AppShellContext);
}

/** Маршруты без интерфейсных островков (страница входа, документация API) */
const BARE_ROUTES = ['/login', '/docs'];

export const SIDEBAR_STORAGE_KEY = 'sotka_sidebar_collapsed';
export const LAYOUT_WIDTH_STORAGE_KEY = 'sotka_crm_layout_width';

/**
 * Инлайн-скрипт для <head>/<body> корневого layout: выставляет атрибуты сайдбара и ширины
 * на <html> до первой отрисовки (как next-themes делает для темы).
 */
export const SHELL_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var c=localStorage.getItem('${SIDEBAR_STORAGE_KEY}');d.setAttribute('data-sidebar',c==='true'?'collapsed':'expanded');var w=localStorage.getItem('${LAYOUT_WIDTH_STORAGE_KEY}');d.setAttribute('data-layout',w==='compact'?'compact':'wide');}catch(e){}})();`;

function readHtmlFlag(attr: string, value: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(attr) === value;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { showToast } = useToast();
  const user = useUser();

  const [pageConfig, setPageConfigState] = React.useState<ShellPageConfig | null>(null);
  const setPageConfig = React.useCallback((config: ShellPageConfig | null) => {
    setPageConfigState(config);
  }, []);
  const contextValue = React.useMemo(() => ({ setPageConfig }), [setPageConfig]);

  // Состояние для React-логики (подсказки, иконки); ширины рисует CSS по атрибутам <html>
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [layoutWidth, setLayoutWidth] = React.useState<'compact' | 'wide'>('wide');

  React.useLayoutEffect(() => {
    setSidebarCollapsed(readHtmlFlag('data-sidebar', 'collapsed'));
    setLayoutWidth(readHtmlFlag('data-layout', 'compact') ? 'compact' : 'wide');
  }, []);

  // Переходы ширины включаются только после первой отрисовки (без анимации при загрузке)
  React.useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      document.documentElement.setAttribute('data-shell-ready', '');
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const handleToggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      document.documentElement.setAttribute('data-sidebar', next ? 'collapsed' : 'expanded');
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleToggleLayoutWidth = React.useCallback(() => {
    setLayoutWidth((prev) => {
      const next = prev === 'wide' ? 'compact' : 'wide';
      document.documentElement.setAttribute('data-layout', next);
      try {
        localStorage.setItem(LAYOUT_WIDTH_STORAGE_KEY, next);
      } catch {}
      showToast(next === 'wide' ? 'Включен режим широкого экрана' : 'Включен компактный режим', 'info');
      return next;
    });
  }, [showToast]);

  const isBare = BARE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  if (isBare) {
    return <AppShellContext.Provider value={contextValue}>{children}</AppShellContext.Provider>;
  }

  const role = user.role;
  // Кнопку создания показывает страница, уже проверившая право; на /leads без регистрации — по праву
  const canCreate = Boolean(pageConfig?.onCreateClick) || (pathname === '/leads' && user.can('leads.create'));
  const onCreateClick = pageConfig?.onCreateClick;
  const createTooltip = pageConfig?.createTooltip || 'Добавить';
  const hideFab = pageConfig?.hideFab ?? false;

  const handleFabClick = () => {
    if (!canCreate) return;
    if (onCreateClick) {
      onCreateClick();
    } else if (pathname === '/leads') {
      window.location.href = '/leads?action=create';
    }
  };

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 selection:bg-zinc-900 selection:text-white dark:selection:bg-white dark:selection:text-zinc-900">
        {/* ДЕСКТОПНЫЙ СЛОЙ (экран >= 1024px) */}
        <DesktopSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          userRole={role}
          userName={user.userName}
          userLogin={user.userLogin}
          onSignOut={user.signOut}
        />

        <TopHeader
          collapsed={sidebarCollapsed}
          userRole={role}
          userName={user.userName}
          searchQuery={pageConfig?.searchQuery}
          onSearchChange={pageConfig?.onSearchChange}
          searchPlaceholder={pageConfig?.searchPlaceholder}
          filterCount={pageConfig?.filterCount}
          filterContent={pageConfig?.filterContent}
          layoutWidth={layoutWidth}
          onToggleLayoutWidth={handleToggleLayoutWidth}
        />

        {/* МОБИЛЬНЫЙ СЛОЙ (экран < 1024px) */}
        <MobileHeader
          searchQuery={pageConfig?.searchQuery}
          onSearchChange={pageConfig?.onSearchChange}
          searchPlaceholder={pageConfig?.searchPlaceholder}
          filterCount={pageConfig?.filterCount}
          filterContent={pageConfig?.filterContent}
        />

        {/* ЦЕНТРАЛЬНАЯ СКРОЛЛИРУЕМАЯ ОБЛАСТЬ: отступ слева задает CSS-переменная --shell-left */}
        <main className="app-main min-h-screen lg:pt-24 lg:pr-6 lg:pb-8 pt-20 px-3 pb-44">
          <div className="app-content mx-auto w-full px-0 sm:px-2 lg:px-4">{children}</div>
        </main>

        {/* Мобильная кнопка FAB под большой палец правой руки */}
        {canCreate && (onCreateClick || pathname === '/leads') && !hideFab && (
          <FAB onClick={handleFabClick} label={createTooltip} />
        )}

        {/* Десктопная кнопка добавления в правом нижнем углу */}
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

        <MobileBottomBar userRole={role} />
      </div>
    </AppShellContext.Provider>
  );
}
