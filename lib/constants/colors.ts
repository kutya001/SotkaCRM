/**
 * Цветовая палитра Apple Island Glassmorphism для сотрудников SotkaCRM
 */

export interface ColorOption {
  value: string;
  label: string;
  bgLight: string;
  bgDark: string;
  textLight: string;
  textDark: string;
  borderLight: string;
  borderDark: string;
  dotClass: string;
}

export const EMPLOYEE_COLORS: ColorOption[] = [
  {
    value: '#3B82F6',
    label: 'Лазурный',
    bgLight: 'bg-blue-500/10',
    bgDark: 'dark:bg-blue-500/15',
    textLight: 'text-blue-600',
    textDark: 'dark:text-blue-400',
    borderLight: 'border-blue-500/25',
    borderDark: 'dark:border-blue-500/35',
    dotClass: 'bg-blue-500',
  },
  {
    value: '#10B981',
    label: 'Изумрудный',
    bgLight: 'bg-emerald-500/10',
    bgDark: 'dark:bg-emerald-500/15',
    textLight: 'text-emerald-600',
    textDark: 'dark:text-emerald-400',
    borderLight: 'border-emerald-500/25',
    borderDark: 'dark:border-emerald-500/35',
    dotClass: 'bg-emerald-500',
  },
  {
    value: '#8B5CF6',
    label: 'Фиолетовый',
    bgLight: 'bg-purple-500/10',
    bgDark: 'dark:bg-purple-500/15',
    textLight: 'text-purple-600',
    textDark: 'dark:text-purple-400',
    borderLight: 'border-purple-500/25',
    borderDark: 'dark:border-purple-500/35',
    dotClass: 'bg-purple-500',
  },
  {
    value: '#F59E0B',
    label: 'Янтарный',
    bgLight: 'bg-amber-500/10',
    bgDark: 'dark:bg-amber-500/15',
    textLight: 'text-amber-600',
    textDark: 'dark:text-amber-400',
    borderLight: 'border-amber-500/25',
    borderDark: 'dark:border-amber-500/35',
    dotClass: 'bg-amber-500',
  },
  {
    value: '#EC4899',
    label: 'Розовый',
    bgLight: 'bg-pink-500/10',
    bgDark: 'dark:bg-pink-500/15',
    textLight: 'text-pink-600',
    textDark: 'dark:text-pink-400',
    borderLight: 'border-pink-500/25',
    borderDark: 'dark:border-pink-500/35',
    dotClass: 'bg-pink-500',
  },
  {
    value: '#06B6D4',
    label: 'Бирюзовый',
    bgLight: 'bg-cyan-500/10',
    bgDark: 'dark:bg-cyan-500/15',
    textLight: 'text-cyan-600',
    textDark: 'dark:text-cyan-400',
    borderLight: 'border-cyan-500/25',
    borderDark: 'dark:border-cyan-500/35',
    dotClass: 'bg-cyan-500',
  },
  {
    value: '#6366F1',
    label: 'Индиго',
    bgLight: 'bg-indigo-500/10',
    bgDark: 'dark:bg-indigo-500/15',
    textLight: 'text-indigo-600',
    textDark: 'dark:text-indigo-400',
    borderLight: 'border-indigo-500/25',
    borderDark: 'dark:border-indigo-500/35',
    dotClass: 'bg-indigo-500',
  },
  {
    value: '#F97316',
    label: 'Оранжевый',
    bgLight: 'bg-orange-500/10',
    bgDark: 'dark:bg-orange-500/15',
    textLight: 'text-orange-600',
    textDark: 'dark:text-orange-400',
    borderLight: 'border-orange-500/25',
    borderDark: 'dark:border-orange-500/35',
    dotClass: 'bg-orange-500',
  },
  {
    value: '#14B8A6',
    label: 'Морской',
    bgLight: 'bg-teal-500/10',
    bgDark: 'dark:bg-teal-500/15',
    textLight: 'text-teal-600',
    textDark: 'dark:text-teal-400',
    borderLight: 'border-teal-500/25',
    borderDark: 'dark:border-teal-500/35',
    dotClass: 'bg-teal-500',
  },
  {
    value: '#64748B',
    label: 'Графитовый',
    bgLight: 'bg-slate-500/10',
    bgDark: 'dark:bg-slate-500/15',
    textLight: 'text-slate-600',
    textDark: 'dark:text-slate-400',
    borderLight: 'border-slate-500/25',
    borderDark: 'dark:border-slate-500/35',
    dotClass: 'bg-slate-500',
  },
];

export const DEFAULT_EMPLOYEE_COLOR = '#3B82F6';

/**
 * Получить конфигурацию цвета по HEX-значению
 */
export function getEmployeeColorConfig(hex?: string | null): ColorOption {
  if (!hex) return EMPLOYEE_COLORS[0];
  const found = EMPLOYEE_COLORS.find(
    (c) => c.value.toLowerCase() === hex.toLowerCase()
  );
  return found || EMPLOYEE_COLORS[0];
}
