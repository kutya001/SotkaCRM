/**
 * Утилиты форматирования дат и времени с детерминированным часовым поясом (Asia/Bishkek).
 * Обеспечивают идентичный вывод на сервере (Vercel SSR UTC) и клиенте (Browser)
 * для полного предотвращения ошибок гидратации React (#418 Hydration Mismatch).
 */

export const BISHKEK_TIMEZONE = 'Asia/Bishkek';

export function formatDate(date: string | number | Date | null | undefined): string {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: BISHKEK_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(date));
  } catch {
    return '—';
  }
}

export function formatShortDate(date: string | number | Date | null | undefined): string {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: BISHKEK_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(date));
  } catch {
    return '—';
  }
}

export function formatDateTime(date: string | number | Date | null | undefined): string {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: BISHKEK_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(date));
  } catch {
    return '—';
  }
}

export function formatShortDateTime(date: string | number | Date | null | undefined): string {
  if (!date) return '—';
  try {
    const d = new Date(date);
    const datePart = new Intl.DateTimeFormat('ru-RU', {
      timeZone: BISHKEK_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
    }).format(d);
    const timePart = new Intl.DateTimeFormat('ru-RU', {
      timeZone: BISHKEK_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
    return `${datePart} ${timePart}`;
  } catch {
    return '—';
  }
}

export function formatMonthYear(date: string | number | Date | null | undefined): string {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: BISHKEK_TIMEZONE,
      month: 'long',
      year: 'numeric',
    }).format(new Date(date));
  } catch {
    return '—';
  }
}
