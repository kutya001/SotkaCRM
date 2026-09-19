import * as React from 'react';
import {
  formatDate,
  formatShortDate,
  formatDateTime,
  formatShortDateTime,
  formatMonthYear,
} from '@/lib/utils/format';

interface FormattedDateProps {
  date: string | number | Date | null | undefined;
  type?: 'date' | 'shortDate' | 'dateTime' | 'shortDateTime' | 'monthYear';
  fallback?: string;
  className?: string;
}

export function FormattedDate({
  date,
  type = 'date',
  fallback = '—',
  className = '',
}: FormattedDateProps) {
  if (!date) {
    return <span className={className}>{fallback}</span>;
  }

  let formatted = fallback;
  switch (type) {
    case 'shortDateTime':
      formatted = formatShortDateTime(date);
      break;
    case 'dateTime':
      formatted = formatDateTime(date);
      break;
    case 'shortDate':
      formatted = formatShortDate(date);
      break;
    case 'monthYear':
      formatted = formatMonthYear(date);
      break;
    case 'date':
    default:
      formatted = formatDate(date);
      break;
  }

  return (
    <span className={className} suppressHydrationWarning>
      {formatted}
    </span>
  );
}
