import * as React from 'react';
import { formatDate, formatDateTime, formatDateOnly, formatMonth } from '@/lib/utils/format';

export type FormattedDateType =
  /** «ДД.ММ.ГГГГ» по отметке времени */
  | 'date'
  /** «ДД.ММ.ГГГГ - чч:мм:сс» */
  | 'dateTime'
  /** «ДД.ММ.ГГГГ» для значения без времени (DATE) — без сдвига пояса */
  | 'dateOnly'
  /** «ММ.ГГГГ» для «ГГГГ-ММ» */
  | 'month'
  /** @deprecated → dateTime */
  | 'shortDateTime'
  /** @deprecated → date */
  | 'shortDate'
  /** @deprecated → month */
  | 'monthYear';

interface FormattedDateProps {
  date: string | number | Date | null | undefined;
  type?: FormattedDateType;
  fallback?: string;
  className?: string;
}

export function formatByType(date: FormattedDateProps['date'], type: FormattedDateType): string {
  switch (type) {
    case 'dateTime':
    case 'shortDateTime':
      return formatDateTime(date);
    case 'dateOnly':
      return formatDateOnly(date);
    case 'month':
    case 'monthYear':
      return formatMonth(date);
    case 'date':
    case 'shortDate':
    default:
      return formatDate(date);
  }
}

export function FormattedDate({ date, type = 'date', fallback = '—', className = '' }: FormattedDateProps) {
  if (date === null || date === undefined || date === '') {
    return <span className={className}>{fallback}</span>;
  }

  const formatted = formatByType(date, type);

  return (
    <span className={className} suppressHydrationWarning>
      {formatted === '—' ? fallback : formatted}
    </span>
  );
}
