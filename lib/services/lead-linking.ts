import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { hasAnyPermission, hasPermission } from '@/lib/auth/permissions';
import { isLeadInScope } from '@/lib/leads/status-rules';
import {
  createSellerConnection,
  deleteConnection,
  participantIdsOf,
  type MaintenanceAssignmentInput,
} from '@/lib/services/connections';

export interface LeadLinkResult {
  success: boolean;
  error?: string;
  connectionId?: string;
  connectionFeeAmount?: number;
  /** pending — подключение ждет подтверждения администратором */
  confirmationStatus?: 'pending' | 'confirmed';
  /** created — подключение создано при привязке; attached — лид привязан к существующему подключению */
  mode?: 'created' | 'attached';
  /** Консультант подключения — ответственный за лид */
  managerId?: string;
}

/** Субъект связывания: серверный AuthContext либо компактная форма { userId, permissions } */
export type LeadLinkActor =
  | { userId: string; permissions: string[] }
  | { profile: { user_id: string }; permissions: string[] };

export interface LeadLinkParams {
  leadId: string;
  sellerPhone: string;
  /**
   * Состав нового подключения (первый — основной, консультант продавца); без права «sellers.assign»
   * основным должен быть ответственный за лид (или сам сотрудник, если ответственного нет).
   * Не используется, если у продавца уже есть подключение.
   */
  participants?: string[];
  /** Сопровождение по месяцам нового подключения (по умолчанию — все участники) */
  maintenance?: MaintenanceAssignmentInput[];
  /** Желаемый консультант (совместимость) — учитывается только при праве «sellers.assign» */
  managerId?: string | null;
  /** Origin запроса — для одноразовой ссылки подтверждения в Telegram (044) */
  appOrigin?: string | null;
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

const uniq = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

function normalizeActor(actor: LeadLinkActor): { userId: string; permissions: string[] } {
  return 'profile' in actor
    ? { userId: actor.profile.user_id, permissions: actor.permissions }
    : { userId: actor.userId, permissions: actor.permissions };
}

/** Текущее (не отклоненное) подключение продавца */
async function activeConnectionOf(sellerPhone: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('connections')
    .select('connection_id, manager_id, confirmation_status, connection_fee_amount, connection_fee')
    .eq('seller_phone', sellerPhone)
    .neq('confirmation_status', 'rejected')
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Привязка лида к продавцу (046). Лид — SQL-функция link_lead_to_seller (продавец, статус «Подписан»,
 * ответственный = консультант подключения). Подключение:
 *  - у продавца уже есть подключение — лид только привязывается, подключение не меняется
 *    (разрешено администратору с «sellers.view_all» и участникам этого подключения);
 *  - продавец свободен — подключение создается тем же путем, что «Подключить…» в продавцах
 *    (участники, сопровождение, подтверждение по праву «connections.confirm», запрос администраторам).
 *
 * Права: «leads.link_seller» (со стороны лида) или «sellers.link_lead» (со стороны продавца);
 * без «leads.view_all» — только свои (назначенные мне / созданные мной) или неназначенные лиды.
 */
export async function linkLeadToSellerAtomic(ctx: LeadLinkActor, params: LeadLinkParams): Promise<LeadLinkResult> {
  const { userId, permissions } = normalizeActor(ctx);

  const requiredKeys = params.via ? [LINK_PERMISSIONS[params.via]] : Object.values(LINK_PERMISSIONS);
  if (!hasAnyPermission(permissions, requiredKeys)) {
    return { success: false, error: 'Недостаточно прав для связывания лида с продавцом' };
  }

  const admin = createAdminClient();

  const { data: lead } = await admin
    .from('leads')
    .select('lead_id, assigned_to, created_by, seller_phone, status')
    .eq('lead_id', params.leadId)
    .maybeSingle();
  if (!lead) return { success: false, error: 'Лид не найден в системе' };
  if (lead.seller_phone) return { success: false, error: `Этот лид уже связан с продавцом +${lead.seller_phone}` };
  if (lead.status === 'Отмена') return { success: false, error: 'Нельзя привязать отмененный лид' };

  if (!hasPermission(permissions, 'leads.view_all')) {
    const isUnassigned = !lead.assigned_to;
    if (!isUnassigned && !isLeadInScope({ userId, permissions }, lead)) {
      return { success: false, error: 'Можно связывать только свои или неназначенные лиды' };
    }
  }

  const { data: seller } = await admin
    .from('sellers')
    .select('seller_phone, manager_id, moderation')
    .eq('seller_phone', params.sellerPhone)
    .maybeSingle();
  if (!seller) return { success: false, error: 'Продавец не найден в базе данных Sotka' };

  const existing = await activeConnectionOf(params.sellerPhone);

  // 1. Продавец уже подключен: лид привязывается к подключению, состав и начисления не меняются
  if (existing) {
    const isAdmin = hasPermission(permissions, 'sellers.view_all');
    if (!isAdmin) {
      const participants = await participantIdsOf(existing.connection_id);
      if (!participants.includes(userId)) {
        return { success: false, error: 'Продавец уже подключен другим консультантом: привязать лид может администратор или участник подключения' };
      }
    }
    const { data, error } = await admin.rpc('link_lead_to_seller', {
      p_lead_id: params.leadId,
      p_seller_phone: params.sellerPhone,
      p_user_id: userId,
      p_manager_id: existing.manager_id,
      p_assigned_by: userId,
      p_confirmation_status: existing.confirmation_status === 'confirmed' ? 'confirmed' : 'pending',
    });
    if (error) {
      console.error('[link_lead_to_seller] RPC error:', error);
      return { success: false, error: 'Ошибка связывания лида с продавцом' };
    }
    const res = (data || {}) as { success?: boolean; error?: string };
    if (!res.success) return { success: false, error: res.error || 'Ошибка связывания лида с продавцом' };

    scheduleTelegramDispatch();
    return {
      success: true,
      mode: 'attached',
      connectionId: existing.connection_id,
      connectionFeeAmount: Number(existing.connection_fee_amount || existing.connection_fee) || undefined,
      confirmationStatus: existing.confirmation_status === 'confirmed' ? 'confirmed' : 'pending',
      managerId: existing.manager_id,
    };
  }

  // 2. Продавец свободен: подключение создается, основной — консультант продавца
  const canChooseManager = hasPermission(permissions, 'sellers.assign');
  const requested = uniq(params.participants || []);
  let primary = requested[0] || (canChooseManager && params.managerId) || lead.assigned_to || userId;
  if (!canChooseManager) {
    const expected = lead.assigned_to || userId;
    if (primary !== expected) {
      return {
        success: false,
        error: lead.assigned_to
          ? 'Консультантом подключения должен быть ответственный за лид'
          : 'Консультантом подключения должны быть вы',
      };
    }
    primary = expected;
  }
  const participants = uniq([primary, ...requested.filter((id) => id !== primary)]);
  if (participants.length > 3) return { success: false, error: 'В подключении может быть не более трех участников' };

  const canConfirm = hasPermission(permissions, 'connections.confirm');
  const created = await createSellerConnection({
    sellerPhone: params.sellerPhone,
    participants,
    maintenance: params.maintenance,
    actor: { user_id: userId },
    canConfirm,
    appOrigin: params.appOrigin,
    primaryUserId: primary,
    requireActorParticipant: false,
  });
  if (!created.success) return { success: false, error: created.error };

  const { data, error } = await admin.rpc('link_lead_to_seller', {
    p_lead_id: params.leadId,
    p_seller_phone: params.sellerPhone,
    p_user_id: userId,
    p_manager_id: primary,
    p_assigned_by: userId,
    p_confirmation_status: created.confirmationStatus === 'confirmed' ? 'confirmed' : 'pending',
  });
  const res = (data || {}) as { success?: boolean; error?: string };
  if (error || !res.success) {
    // Лид не привязан (гонка, коллизия) — созданное подключение снимается, продавец освобождается
    if (error) console.error('[link_lead_to_seller] RPC error:', error);
    await deleteConnection(created.connectionId).catch((err) => console.error('[link_lead_to_seller] rollback:', err));
    return { success: false, error: res.error || 'Ошибка связывания лида с продавцом' };
  }

  const { data: conn } = await admin
    .from('connections')
    .select('connection_fee_amount, connection_fee')
    .eq('connection_id', created.connectionId)
    .maybeSingle();

  scheduleTelegramDispatch();
  return {
    success: true,
    mode: 'created',
    connectionId: created.connectionId,
    connectionFeeAmount: Number(conn?.connection_fee_amount || conn?.connection_fee) || undefined,
    confirmationStatus: created.confirmationStatus === 'confirmed' ? 'confirmed' : 'pending',
    managerId: primary,
  };
}

export interface LeadUnlinkResult {
  success: boolean;
  error?: string;
  leadId?: string;
  sellerPhone?: string;
  /** Ожидающее подключение снято вместе с привязкой */
  connectionDeleted?: boolean;
}

/**
 * Отвязка лида от продавца (046): лид — «Назначен» (ответственный сохраняется), продавец:
 *  - подключение ожидает подтверждения — снимается (консультант у продавца освобождается);
 *  - подключение подтверждено — остается, лид просто отцепляется;
 *  - подключения нет — у продавца снимается консультант (устаревшие данные).
 */
export async function unlinkLeadFromSeller(leadId: string): Promise<LeadUnlinkResult> {
  const admin = createAdminClient();
  const { data, error } = await (admin.rpc as any)('unlink_lead_and_seller', { p_lead_id: leadId });
  if (error) {
    const message = String(error.message || '');
    if (/не привязан/i.test(message)) return { success: false, error: 'Лид не привязан к продавцу' };
    if (/не найден/i.test(message)) return { success: false, error: 'Лид не найден' };
    console.error('[unlink_lead_and_seller] RPC error:', error);
    return { success: false, error: 'Ошибка отвязки лида от продавца' };
  }
  const res = (data || {}) as { success?: boolean; seller_phone?: string };
  if (!res.success || !res.seller_phone) return { success: false, error: 'Ошибка отвязки лида от продавца' };

  let connectionDeleted = false;
  const existing = await activeConnectionOf(res.seller_phone);
  if (existing && existing.confirmation_status === 'pending') {
    const del = await deleteConnection(existing.connection_id);
    if (!del.success) return { success: false, error: del.error };
    connectionDeleted = true;
  } else if (!existing) {
    await admin.from('sellers').update({ manager_id: null }).eq('seller_phone', res.seller_phone);
  }

  scheduleTelegramDispatch();
  return { success: true, leadId, sellerPhone: res.seller_phone, connectionDeleted };
}
