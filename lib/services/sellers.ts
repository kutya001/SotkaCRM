import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

type SellerRow = Database['public']['Tables']['sellers']['Row'];

/**
 * Область видимости продавцов без права «sellers.view_all» (фильтр PostgREST для .or()):
 * свои (manager_id = я) и свободные одобренные (manager_id IS NULL AND moderation = 'approved').
 */
export function sellersOwnScopeFilter(userId: string): string {
  return `manager_id.eq.${userId},and(manager_id.is.null,moderation.eq.approved)`;
}

/** Попадает ли карточка продавца в область видимости сотрудника */
export function isSellerInScope(
  ctx: { canViewAll: (module: string) => boolean; profile: { user_id: string } },
  seller: { manager_id: string | null; moderation: string }
): boolean {
  if (ctx.canViewAll('sellers')) return true;
  if (seller.manager_id === ctx.profile.user_id) return true;
  return seller.manager_id === null && seller.moderation === 'approved';
}

/** Безопасно декодирует параметр маршрута (телефон «+996...» может прийти как «%2B996...») */
function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * Поиск продавца по ключу из URL: ID организации Sotka HQ (organization_id) или телефон.
 *
 * В таблице sellers нет колонки seller_id, поэтому прежний фильтр
 * `.or('seller_id.eq.…,seller_phone.eq.…')` возвращал ошибку и продавец «не находился».
 * Фильтры через .eq, а не строковый .or(): значение из URL не попадает в синтаксис PostgREST.
 */
export async function findSellerByKey<K extends keyof SellerRow>(
  supabase: SupabaseClient<Database>,
  rawKey: string,
  columns: readonly K[]
): Promise<Pick<SellerRow, K> | null> {
  const key = decodeKey(rawKey);
  if (!key) return null;

  const select = columns.join(', ');

  for (const field of ['organization_id', 'seller_phone'] as const) {
    const { data, error } = await supabase
      .from('sellers')
      .select(select)
      .eq(field, key)
      .limit(1);

    if (error) throw error;
    if (data && data.length > 0) {
      return data[0] as unknown as Pick<SellerRow, K>;
    }
  }

  return null;
}

/** Колонки, по которым список продавцов можно сортировать на сервере */
export const SELLER_SORT_COLUMNS = [
  'registered_at',
  'balance',
  'synced_at',
  'store',
  'seller_name',
  'outlets_count',
  'last_activity',
] as const;

/**
 * Порядок списка продавцов. По умолчанию — по дате регистрации (новые сверху).
 *
 * Сортировка всегда заканчивается уникальным ключом: без него строки с одинаковым значением
 * (например, одинаковый synced_at у всех продавцов после синхронизации или пустая дата регистрации)
 * возвращаются в произвольном порядке, и после любого UPDATE (назначение консультанта) строка
 * «перепрыгивала» на другое место.
 * organization_seq — числовой ID организации Sotka HQ (растет с регистрацией), заменяет
 * дату регистрации, если Sotka ее не передала.
 */
export function applySellersOrder<Q>(query: Q, sortBy?: string | null, sortOrder?: string | null): Q {
  const ascending = sortOrder === 'asc';
  let q = query as any;

  if (sortBy && sortBy !== 'registered_at' && (SELLER_SORT_COLUMNS as readonly string[]).includes(sortBy)) {
    q = q.order(sortBy, { ascending, nullsFirst: false });
  }

  return q
    .order('registered_at', { ascending, nullsFirst: false })
    .order('organization_seq', { ascending, nullsFirst: false })
    .order('seller_phone', { ascending: true }) as Q;
}
