import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import type { AuthContext } from '@/lib/auth/check-role';
import type { UserRole } from '@/types/database.types';

export interface LeadLinkResult {
  success: boolean;
  error?: string;
  connectionId?: string;
  connectionFeeAmount?: number;
  /** pending — подключение ждет подтверждения администратором */
  confirmationStatus?: 'pending' | 'confirmed';
}

/** Роли, которые привязывают лид с подтвержденным подключением (руководитель — только просмотр) */
const PRIVILEGED_ROLES: UserRole[] = ['admin'];

/**
 * Атомарное связывание лида с продавцом через RPC link_lead_to_seller.
 *
 * RPC доступна только service_role (миграция 029), поэтому права проверяются здесь:
 * - admin может указать любого куратора (managerId), подключение сразу подтверждено;
 * - consultant связывает только свои или неназначенные лиды, куратором становится лид-владелец
 *   или сам консультант — переданный managerId игнорируется; подключение ожидает
 *   подтверждения администратором (начисление — после подтверждения, миграция 037).
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

  // Единственная реализация RPC (миграция 037): все параметры передаются явно
  const { data, error } = await (createAdminClient().rpc as any)('link_lead_to_seller', {
    p_lead_id: params.leadId,
    p_seller_phone: params.sellerPhone,
    p_user_id: profile.user_id,
    p_manager_id: (isPrivileged && params.managerId) || null,
    p_assigned_by: profile.user_id,
    p_confirmation_status: isPrivileged ? 'confirmed' : 'pending',
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
    confirmation_status?: 'pending' | 'confirmed';
  };

  if (!res.success) {
    return { success: false, error: res.error || 'Ошибка связывания лида с продавцом' };
  }

  scheduleTelegramDispatch();

  return {
    success: true,
    connectionId: res.connection_id,
    connectionFeeAmount: res.connection_fee_amount,
    confirmationStatus: res.confirmation_status,
  };
}
