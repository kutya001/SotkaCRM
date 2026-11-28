/**
 * Проверка дубликата номера: лиды с тем же номером и продавец платформы с этим номером.
 * Предупреждение, а не запрет: лид с таким номером можно сохранить.
 * Чужие лиды (вне области видимости) показываются без имени клиента — только статус и ответственный.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_COUNTRY_CODE, digitsOnly, normalizeNational, toFullDigits } from '@/lib/utils/phone';
import { isLeadInScope, type LeadActor } from '@/lib/leads/status-rules';
import { leadPhoneKey } from '@/lib/leads/duplicates';

export interface DuplicateLead {
  lead_id: string;
  /** Видим ли лид сотруднику (свой или право «видеть все») */
  visible: boolean;
  /** Имя клиента — только для видимых лидов */
  client_name: string | null;
  status: string;
  assigned_name: string | null;
  created_at: string;
}

export interface DuplicateSeller {
  seller_phone: string;
  seller_name: string;
  manager_name: string | null;
  moderation: string;
}

export interface PhoneDuplicatesResult {
  /** Полный номер цифрами, по которому искали */
  phone_key: string;
  leads: DuplicateLead[];
  seller: DuplicateSeller | null;
}

const EMPTY = (key: string): PhoneDuplicatesResult => ({ phone_key: key, leads: [], seller: null });

export async function findPhoneDuplicates(
  actor: LeadActor,
  phone: string,
  countryCode: string | null | undefined,
  excludeLeadId?: string | null
): Promise<PhoneDuplicatesResult> {
  const code = digitsOnly(countryCode) || DEFAULT_COUNTRY_CODE;
  const national = normalizeNational(phone, code);
  const key = toFullDigits(code, national);
  // Слишком короткий номер (еще вводится) не проверяем
  if (national.length < 7) return EMPTY(key);

  const admin = createAdminClient();
  const [leadsRes, sellersRes] = await Promise.all([
    admin
      .from('leads')
      .select('lead_id, client_name, phone, country_code, status, created_at, created_by, assigned_to, assigned_user:users!leads_assigned_to_fkey(full_name)')
      .in('phone', Array.from(new Set([national, key])))
      .order('created_at', { ascending: false })
      .limit(20),
    // Продавцы платформы хранят национальный номер (9 цифр для Кыргызстана)
    admin
      .from('sellers')
      .select('seller_phone, seller_name, moderation, manager_id')
      .in('seller_phone', Array.from(new Set([national, key])))
      .eq('is_deleted_from_source', false)
      .limit(1),
  ]);
  if (leadsRes.error) throw leadsRes.error;

  const leads: DuplicateLead[] = (leadsRes.data || [])
    .filter((l: any) => l.lead_id !== excludeLeadId && leadPhoneKey(l.phone, l.country_code) === key)
    .map((l: any) => {
      const visible = isLeadInScope(actor, l);
      const assigned = Array.isArray(l.assigned_user) ? l.assigned_user[0] : l.assigned_user;
      return {
        lead_id: l.lead_id,
        visible,
        client_name: visible ? l.client_name : null,
        status: l.status,
        assigned_name: assigned?.full_name ?? null,
        created_at: l.created_at,
      };
    });

  let seller: DuplicateSeller | null = null;
  const sellerRow = sellersRes.error ? null : sellersRes.data?.[0];
  if (sellerRow) {
    let managerName: string | null = null;
    if (sellerRow.manager_id) {
      const { data: manager } = await admin.from('users').select('full_name').eq('user_id', sellerRow.manager_id).maybeSingle();
      managerName = manager?.full_name ?? null;
    }
    seller = {
      seller_phone: sellerRow.seller_phone,
      seller_name: sellerRow.seller_name,
      manager_name: managerName,
      moderation: String(sellerRow.moderation),
    };
  }

  return { phone_key: key, leads, seller };
}
