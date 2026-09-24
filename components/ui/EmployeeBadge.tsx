'use client';

import * as React from 'react';
import {
  EMPLOYEE_COLORS,
  getEmployeeColorConfig,
  isValidHex,
  normalizeHex,
  hexToRgba,
  getContrastTextColor,
} from '@/lib/constants/colors';

interface EmployeeBadgeProps {
  name: string;
  color?: string | null;
  role?: string | null;
  showRole?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export function EmployeeBadge({
  name,
  color,
  role,
  showRole = false,
  size = 'md',
  className = '',
}: EmployeeBadgeProps) {
  const colorCfg = getEmployeeColorConfig(color);
  const isCustom = !EMPLOYEE_COLORS.some(
    (c) => c.value.toLowerCase() === color?.trim().toLowerCase()
  );
  const customHex = color && isValidHex(color) ? normalizeHex(color) : null;
  const initial = name ? name.trim().charAt(0).toUpperCase() : '?';

  const sizeClasses = {
    xs: {
      pill: 'h-5 px-1.5 text-[10px] gap-1',
      avatar: 'w-3.5 h-3.5 text-[8px]',
      dot: 'w-1 h-1',
    },
    sm: {
      pill: 'h-6 px-2 text-[11px] gap-1.5',
      avatar: 'w-4 h-4 text-[9px]',
      dot: 'w-1.5 h-1.5',
    },
    md: {
      pill: 'h-7 px-2.5 text-xs gap-2',
      avatar: 'w-5 h-5 text-[10px]',
      dot: 'w-2 h-2',
    },
    lg: {
      pill: 'h-9 px-3 text-sm gap-2.5',
      avatar: 'w-6 h-6 text-xs',
      dot: 'w-2.5 h-2.5',
    },
  }[size];

  // Динамические стили для кастомного HEX с расчетом YIQ-контрастности текста
  const customPillStyle: React.CSSProperties | undefined =
    isCustom && customHex
      ? {
          backgroundColor: hexToRgba(customHex, 0.12),
          borderColor: hexToRgba(customHex, 0.28),
        }
      : undefined;

  const customAvatarStyle: React.CSSProperties | undefined =
    isCustom && customHex
      ? {
          backgroundColor: customHex,
          color: getContrastTextColor(customHex),
        }
      : undefined;

  return (
    <div
      style={customPillStyle}
      className={`inline-flex items-center rounded-xl font-medium border transition-all ${
        !isCustom
          ? `${colorCfg.bgLight} ${colorCfg.bgDark} ${colorCfg.borderLight} ${colorCfg.borderDark}`
          : ''
      } ${sizeClasses.pill} ${className}`}
      title={`${name}${role ? ` (${role})` : ''}`}
    >
      <span
        style={customAvatarStyle}
        className={`rounded-full flex items-center justify-center font-bold shadow-xs ${
          !isCustom ? `${colorCfg.dotClass} text-white` : ''
        } ${sizeClasses.avatar}`}
      >
        {initial}
      </span>
      <span
        className={`truncate font-semibold ${
          !isCustom
            ? `${colorCfg.textLight} ${colorCfg.textDark}`
            : 'text-zinc-900 dark:text-zinc-100'
        }`}
      >
        {name}
      </span>
      {showRole && role && (
        <span className="text-[10px] opacity-60 font-normal truncate">
          • {role}
        </span>
      )}
    </div>
  );
}

/**
 * Круглый цветовой маркер сотрудника (dot)
 */
export function EmployeeColorDot({
  color,
  size = 'sm',
  className = '',
}: {
  color?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const colorCfg = getEmployeeColorConfig(color);
  const isCustom = !EMPLOYEE_COLORS.some(
    (c) => c.value.toLowerCase() === color?.trim().toLowerCase()
  );
  const customHex = color && isValidHex(color) ? normalizeHex(color) : null;

  const sizeClasses = {
    xs: 'w-1.5 h-1.5',
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  }[size];

  return (
    <span
      style={isCustom && customHex ? { backgroundColor: customHex } : undefined}
      className={`inline-block rounded-full flex-shrink-0 ${
        !isCustom ? colorCfg.dotClass : ''
      } ${sizeClasses} ${className}`}
    />
  );
}
