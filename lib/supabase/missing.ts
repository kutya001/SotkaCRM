/**
 * Ошибка «таблица не найдена»: миграция еще не применена к базе.
 * Postgres — 42P01 (undefined_table), PostgREST — PGRST205 (нет в кэше схемы).
 * Код, читающий новые таблицы, по этой ошибке переходит в запасной режим, а не падает.
 */
export function isMissingRelationError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /relation .* does not exist|Could not find the table/i.test(e.message || '');
}
