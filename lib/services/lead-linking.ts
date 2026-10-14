import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { hasAnyPermission, hasPermission } from '@/lib/auth/permissions';
import { isLeadInScope } from '@/lib/leads/status-rules';

export interface LeadLinkResult {
  success: boolean;
  error?: string;
  connectionId?: string;
  connectionFeeAmount?: number;
  /** pending — подключение ждет подтверждения администратором */
  confirmationStatus?: 'pending' | 'confirmed';
}

/** Субъект связывания: серверный AuthContext либо компактная форма { userId, permissions } */
export type LeadLinkActor =
  | { userId: string; permissions: string[] }
  | { profile: { user_id: string }; permissions: string[] };

export interface LeadLinkParams {
  leadId: string;
  sellerPhone: string;
  /** Желаемый консультант — учитывается только при праве «sellers.assign» */
  managerId?: string | null;
  /**
   * Откуда инициировано связывание: со стороны лида («leads.link_seller») или продавца («sellers.link_lead»).
   * Если не указано — достаточно любого из двух прав.
   */
  via?: 'lead' | 'seller';
}

const LINK_PERMISSIONS: Record<NonNullable<LeadLinkParams['via']>, string> = {
  lead: 'leads.link_seller',
  seller: 'sellers.link_lead',
};

function normalizeActor(actor: LeadLinkActor): { userId: string; permissions: string[] } {
  return 'profile' in actor
    ? { userId: actor.profile.user_id, permissions: actor.permissions }
    : { userId: actor.userId, permissions: actor.permissions };
}

/**
 * Атомарное связывание лида с продавцом через RPC link_lead_to_seller.
 *
 * RPC доступна только service_role (миграция 029), поэтому права проверяются здесь:
 * - право связывания: «leads.link_seller» (со стороны лида) или «sellers.link_lead» (со стороны продавца);
 * - без «leads.view_all» связывать можно только свои (назначенные мне / созданные мной) или неназначенные лиды;
 * - выбор консультанта (managerId) — только с правом «sellers.assign», иначе консультантом становится
 *   ответственный за лид либо сам сотрудник;
 * - подключение подтверждается сразу при праве «connections.confirm», иначе ожидает подтверждения
 *   (начисление — после подтверждения, миграция 037).
 */
export async function linkLeadToSellerAtomic(ctx: LeadLinkActor, params: LeadLinkParams): Promise<LeadLinkResult> {
  const { userId, permissions } = normalizeActor(ctx);

  const requiredKeys = params.via ? [LINK_PERMISSIONS[params.via]] : Object.values(LINK_PERMISSIONS);
  if (!hasAnyPermission(permissions, requiredKeys)) {
    return { success: false, error: 'Недостаточно прав для связывания лида с продавцом' };
  }

  const admin = createAdminClient();

  if (!hasPermission(permissions, 'leads.view_all')) {
    const { data: lead } = await admin
      .from('leads')
      .select('lead_id, assigned_to, created_by')
      .eq('lead_id', params.leadId)
      .maybeSingle();

    if (!lead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    const isUnassigned = !lead.assigned_to;
    if (!isUnassigned && !isLeadInScope({ userId, permissions }, lead)) {
      return { success: false, error: 'Можно связывать только свои или неназначенные лиды' };
    }
  }

  const canChooseManager = hasPermission(permissions, 'sellers.assign');
  const confirmationStatus: 'pending' | 'confirmed' = hasPermission(permissions, 'connections.confirm')
    ? 'confirmed'
    : 'pending';

  // Единственная реализация RPC (миграция 037): все параметры передаются явно
  const { data, error } = await admin.rpc('link_lead_to_seller', {
    p_lead_id: params.leadId,
    p_seller_phone: params.sellerPhone,
    p_user_id: userId,
    p_manager_id: (canChooseManager && params.managerId) || null,
    p_assigned_by: userId,
    p_confirmation_status: confirmationStatus,
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
