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

/**
 * Колонка, которой нет в базе (миграция не применена): PostgREST PGRST204
 * «Could not find the 'x' column of 'y' in the schema cache» или Postgres 42703 «column y.x does not exist».
 * Возвращает имя колонки или null.
 */
export function missingColumnName(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return null;
  const msg = e.message || '';
  const cache = msg.match(/Could not find the '([^']+)' column/i);
  if (cache) return cache[1];
  const pg = msg.match(/column (?:"?[\w]+"?\.)?"?([\w]+)"? does not exist/i);
  if (pg && (e.code === '42703' || /does not exist/i.test(msg))) return pg[1];
  return null;
}

/** Значения нет в enum (новый статус до миграции): Postgres 22P02 «invalid input value for enum …» */
export function missingEnumValue(error: unknown): string | null {
  const e = error as { message?: string } | null;
  const m = (e?.message || '').match(/invalid input value for enum [\w.]+: "([^"]+)"/i);
  return m ? m[1] : null;
}

/** Понятное сообщение, если запрос упал из-за неприменённой миграции; иначе null */
export function schemaMismatchMessage(error: unknown): string | null {
  const column = missingColumnName(error);
  if (column) {
    return `База данных еще не обновлена: нет колонки «${column}». Администратору нужно применить последние миграции (supabase/migrations), затем повторить действие.`;
  }
  const value = missingEnumValue(error);
  if (value) {
    return `База данных еще не знает значение «${value}». Администратору нужно применить последние миграции (supabase/migrations), затем повторить действие.`;
  }
  return null;
}
