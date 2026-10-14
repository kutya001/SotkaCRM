import {
  LayoutDashboard,
  UserCheck,
  Store,
  Link2,
  Receipt,
  Users,
  BookOpen,
  BarChart3,
  ListTodo,
  Target,
  Send,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  /** Право «видеть в меню» из каталога lib/auth/permissions-catalog.ts */
  permission: string;
}

/** Единый список разделов для сайдбара, мобильного меню и нижней панели */
export const NAV_ITEMS: NavItem[] = [
  { title: 'Главная', href: '/', icon: LayoutDashboard, permission: 'dashboard.menu' },
  { title: 'Лиды', href: '/leads', icon: UserCheck, permission: 'leads.menu' },
  { title: 'Продавцы', href: '/sellers', icon: Store, permission: 'sellers.menu' },
  { title: 'Подключения', href: '/connections', icon: Link2, permission: 'connections.menu' },
  { title: 'Операции по ЗП', href: '/payouts', icon: Receipt, permission: 'payouts.menu' },
  { title: 'Сотрудники', href: '/employees', icon: Users, permission: 'employees.menu' },
  { title: 'Тарифы', href: '/plans', icon: BookOpen, permission: 'plans.menu' },
  { title: 'Аналитика', href: '/analytics', icon: BarChart3, permission: 'analytics.menu' },
  { title: 'Задачи', href: '/tasks', icon: ListTodo, permission: 'tasks.menu' },
  { title: 'Планы', href: '/goals', icon: Target, permission: 'goals.menu' },
  { title: 'Telegram', href: '/telegram', icon: Send, permission: 'telegram.menu' },
];

/** Право на открытие маршрута (для оболочки и middleware-подобных проверок на клиенте) */
export function routePermission(pathname: string): string | null {
  if (pathname === '/') return 'dashboard.menu';
  if (pathname.startsWith('/docs')) return 'docs.menu';
  if (pathname.startsWith('/rates')) return 'employees.menu';
  const item = NAV_ITEMS.find((n) => n.href !== '/' && pathname.startsWith(n.href));
  return item ? item.permission : null;
}
