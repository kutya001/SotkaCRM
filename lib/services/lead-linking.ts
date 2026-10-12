import { createAdminClient } from '@/lib/supabase/admin';
import type { AuthContext } from '@/lib/auth/check-role';
import type { UserRole } from '@/types/database.types';

export interface LeadLinkResult {
  success: boolean;
  error?: string;
  connectionId?: string;
  connectionFeeAmount?: number;
}

const PRIVILEGED_ROLES: UserRole[] = ['admin', 'supervisor'];

/**
 * Атомарное связывание лида с продавцом через RPC link_lead_to_seller.
 *
 * RPC доступна только service_role (миграция 029), поэтому права проверяются здесь:
 * - admin/supervisor могут указать любого куратора (managerId);
 * - consultant связывает только свои или неназначенные лиды, куратором становится лид-владелец
 *   или сам консультант — переданный managerId игнорируется.
 */
export async function linkLeadToSellerAtomic(
  ctx: AuthContext,
  params: { leadId: string; sellerPhone: string; managerId?: string | null }
): Promise<LeadLinkResult> {
  const { profile, supabase } = ctx;

  if (!PRIVILEGED_ROLES.includes(profile.role) && profile.role !== 'consultant') {
    return { success: false, error: 'Недостаточно прав для связывания лида с продавцом' };
  }

  const isPrivileged = PRIVILEGED_ROLES.includes(profile.role);

  if (!isPrivileged) {
    // Чтение с клиентом пользователя: RLS скрывает чужие лиды
    const { data: lead } = await supabase
      .from('leads')
      .select('lead_id, assigned_to')
      .eq('lead_id', params.leadId)
      .maybeSingle();

    if (!lead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    if (lead.assigned_to && lead.assigned_to !== profile.user_id) {
      return { success: false, error: 'Можно связывать только свои лиды' };
    }
  }

  // p_user_id однозначно выбирает 5-аргументную перегрузку (в БД есть и 4-аргументная,
  // без p_user_id PostgREST не может выбрать между ними)
  const { data, error } = await createAdminClient().rpc('link_lead_to_seller', {
    p_lead_id: params.leadId,
    p_user_id: profile.user_id,
    p_seller_phone: params.sellerPhone,
    p_manager_id: (isPrivileged && params.managerId) || undefined,
    p_assigned_by: profile.user_id,
  });

  if (error) {
    console.error('[link_lead_to_seller] RPC error:', error);
    return { success: false, error: 'Ошибка связывания лида с продавцом' };
  }

  const res = (data || {}) as {
    success?: boolean;
    error?: string;
    connection_id?: string;
    connection_fee_amount?: number;
  };

  if (!res.success) {
    return { success: false, error: res.error || 'Ошибка связывания лида с продавцом' };
  }

  return {
    success: true,
    connectionId: res.connection_id,
    connectionFeeAmount: res.connection_fee_amount,
  };
}
