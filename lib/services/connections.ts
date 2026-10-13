import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import type { AuthContext } from '@/lib/auth/check-role';
import type { ConnectionConfirmationStatus } from '@/types/database.types';

/**
 * Подключения продавцов к кураторам: назначение куратора и подтверждение администратором.
 *
 * Записи в sellers/connections разрешены RLS только администратору, поэтому сервис пишет
 * сервисным клиентом после проверки прав вызывающим маршрутом.
 *
 * Правило 037: подключение консультанта («Взять себе», привязка лида) создается со статусом
 * pending; начисление за подключение (триггер 035) и уведомления (036) срабатывают при
 * подтверждении администратором.
 */

export type ServiceError = { success: false; error: string; code: string; status: number };
export type ServiceResult<T> = ({ success: true } & T) | ServiceError;

const fail = (error: string, code: string, status = 400): ServiceError => ({ success: false, error, code, status });

type Actor = Pick<AuthContext['profile'], 'user_id' | 'role'>;

interface AssignParams {
  sellerPhone: string;
  managerId: string | null;
  actor: Actor;
  /** confirmed — назначение администратором; pending — консультант взял продавца сам */
  confirmation: Extract<ConnectionConfirmationStatus, 'confirmed' | 'pending'>;
  /** Продавец должен быть без куратора (защита от гонки двух консультантов) */
  expectUnassigned?: boolean;
  /** Только одобренный модерацией продавец (самоназначение консультанта) */
  requireApproved?: boolean;
}

/** Цена тарифа и ставка куратора на текущую дату */
async function resolvePlanPriceAndRate(
  admin: ReturnType<typeof createAdminClient>,
  planId: string | null,
  managerId: string
): Promise<{ planPrice: number; connectionPercent: number; maintenancePercent: number }> {
  let planPrice = 2500;
  const today = new Date().toISOString().substring(0, 10);
  const currentMonth = today.substring(0, 7);

  if (planId) {
    const { data: priceData } = await admin.rpc('get_plan_price_on_date', { p_plan_id: planId, p_date: today });
    if (priceData && Number(priceData) > 0) {
      planPrice = Number(priceData);
    } else {
      const { data: planData } = await admin.from('plans').select('price').eq('plan_id', planId).maybeSingle();
      if (planData && Number(planData.price) > 0) planPrice = Number(planData.price);
    }
  }

  let connectionPercent = 30;
  let maintenancePercent = 10;
  const { data: rpcRate } = await admin.rpc('get_employee_rate_on_month', {
    p_user_id: managerId,
    p_month: currentMonth,
  });
  const rateRow = Array.isArray(rpcRate) ? rpcRate[0] : (rpcRate as any);
  if (rateRow && typeof rateRow === 'object') {
    if ('connection_percent' in rateRow) connectionPercent = Number(rateRow.connection_percent) || 30;
    if ('maintenance_percent' in rateRow) maintenancePercent = Number(rateRow.maintenance_percent) || 10;
  }

  return { planPrice, connectionPercent, maintenancePercent };
}

/**
 * Назначение / снятие куратора продавца с синхронизацией подключения.
 * При managerId = null подключение удаляется (как и прежде — вместе с начислениями по триггеру).
 */
export async function assignSellerToManager(
  params: AssignParams
): Promise<ServiceResult<{ connectionId?: string; confirmationStatus?: ConnectionConfirmationStatus }>> {
  const { sellerPhone, managerId, actor, confirmation, expectUnassigned = false, requireApproved = false } = params;
  if (!sellerPhone) return fail('Не указан номер телефона продавца', 'MISSING_PHONE');

  const admin = createAdminClient();

  const { data: seller, error: sellerErr } = await admin
    .from('sellers')
    .select('seller_phone, seller_name, store, plan_id, manager_id, moderation, is_active')
    .eq('seller_phone', sellerPhone)
    .maybeSingle();
  if (sellerErr) return fail(sellerErr.message, 'DB_ERROR', 500);
  if (!seller) return fail('Продавец не найден', 'NOT_FOUND', 404);

  if (requireApproved && seller.moderation !== 'approved') {
    return fail('Взять можно только продавца, одобренного модерацией Sotka', 'SELLER_NOT_APPROVED', 409);
  }

  // 1. Куратор в карточке продавца (при expectUnassigned — только если он еще свободен)
  let updateSeller = admin.from('sellers').update({ manager_id: managerId }).eq('seller_phone', sellerPhone);
  if (expectUnassigned) updateSeller = updateSeller.is('manager_id', null);
  const { data: updatedRows, error: updateErr } = await updateSeller.select('seller_phone');
  if (updateErr) return fail(updateErr.message, 'DB_ERROR', 500);
  if (!updatedRows || updatedRows.length === 0) {
    return fail('У продавца уже есть куратор', 'SELLER_ALREADY_TAKEN', 409);
  }

  // 2. Снятие куратора: подключение удаляется (начисления чистит триггер)
  if (!managerId) {
    const { error: delErr } = await admin.from('connections').delete().eq('seller_phone', sellerPhone);
    if (delErr) return fail(delErr.message, 'DB_ERROR', 500);
    scheduleTelegramDispatch();
    return { success: true };
  }

  // 3. Тариф и ставка на дату назначения
  const { planPrice, connectionPercent, maintenancePercent } = await resolvePlanPriceAndRate(
    admin,
    seller.plan_id,
    managerId
  );
  const connectionFeeAmount = Math.round(((planPrice * connectionPercent) / 100) * 100) / 100;
  const maintenanceFeeMonthly = Math.round(((planPrice * maintenancePercent) / 100) * 100) / 100;
  const now = new Date();
  const nowIso = now.toISOString();
  const currentMonth = nowIso.substring(0, 7);
  const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const maintenanceMonthStart = nextMonthDate.toISOString().substring(0, 7);

  const confirmationFields = {
    confirmation_status: confirmation,
    confirmed_by: confirmation === 'confirmed' ? actor.user_id : null,
    confirmed_at: confirmation === 'confirmed' ? nowIso : null,
    rejection_reason: null,
  };

  // 4. Подключение продавца одно: существующее обновляется, иначе создается
  const { data: existing } = await admin
    .from('connections')
    .select('connection_id, manager_id, confirmation_status')
    .eq('seller_phone', sellerPhone)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const restart = existing.confirmation_status === 'rejected' || existing.manager_id !== managerId;
    const { error: connErr } = await admin
      .from('connections')
      .update({
        manager_id: managerId,
        assigned_by: actor.user_id,
        assigned_at: nowIso,
        plan_id: seller.plan_id,
        plan_price: planPrice,
        connection_fee_percent: connectionPercent,
        connection_fee_amount: connectionFeeAmount,
        maintenance_fee_monthly: maintenanceFeeMonthly,
        ...(restart
          ? {
              status: 'подключен',
              client_status: 'новый',
              accrual_month: currentMonth,
              maintenance_month_start: maintenanceMonthStart,
            }
          : {}),
        ...confirmationFields,
      })
      .eq('connection_id', existing.connection_id);
    if (connErr) return fail(connErr.message, 'DB_ERROR', 500);

    scheduleTelegramDispatch();
    return { success: true, connectionId: existing.connection_id, confirmationStatus: confirmation };
  }

  const { data: created, error: insertErr } = await admin
    .from('connections')
    .insert({
      seller_phone: sellerPhone,
      seller_name: seller.seller_name,
      store: seller.store || 'Без названия',
      manager_id: managerId,
      assigned_by: actor.user_id,
      assigned_at: nowIso,
      status: 'подключен',
      plan_id: seller.plan_id,
      plan_price: planPrice,
      connection_fee_percent: connectionPercent,
      connection_fee_amount: connectionFeeAmount,
      connection_fee: connectionFeeAmount,
      maintenance_fee_monthly: maintenanceFeeMonthly,
      accrual_month: currentMonth,
      maintenance_month_start: maintenanceMonthStart,
      client_status: 'новый',
      maintenance_months_limit: 3,
      maintenance_months_total: 2,
      maintenance_months_accrued: 0,
      ...confirmationFields,
    })
    .select('connection_id')
    .single();
  if (insertErr) return fail(insertErr.message, 'DB_ERROR', 500);

  scheduleTelegramDispatch();
  return { success: true, connectionId: created.connection_id, confirmationStatus: confirmation };
}

interface ConfirmationParams {
  connectionId: string;
  action: 'confirm' | 'reject';
  reason?: string | null;
  actor: Actor;
}

/**
 * Подтверждение или отклонение подключения администратором.
 * confirm: только из pending → confirmed (начисление и уведомление — триггеры 035/036).
 * reject: pending → rejected с причиной; куратор у продавца снимается, привязанный лид
 * возвращается в «Назначен» (RPC unlink_lead_and_seller).
 */
export async function setConnectionConfirmation(
  params: ConfirmationParams
): Promise<ServiceResult<{ connectionId: string; confirmationStatus: ConnectionConfirmationStatus; sellerPhone: string }>> {
  const { connectionId, action, actor } = params;
  const reason = (params.reason || '').trim();
  const admin = createAdminClient();

  const { data: conn, error: connErr } = await admin
    .from('connections')
    .select('connection_id, seller_phone, manager_id, confirmation_status')
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (connErr) return fail(connErr.message, 'DB_ERROR', 500);
  if (!conn) return fail('Подключение не найдено', 'NOT_FOUND', 404);

  if (conn.confirmation_status !== 'pending') {
    return fail(
      conn.confirmation_status === 'confirmed'
        ? 'Подключение уже подтверждено'
        : 'Подключение уже отклонено — консультант может взять продавца заново',
      'NOT_PENDING',
      409
    );
  }

  const nowIso = new Date().toISOString();

  if (action === 'confirm') {
    const { error } = await admin
      .from('connections')
      .update({
        confirmation_status: 'confirmed',
        confirmed_by: actor.user_id,
        confirmed_at: nowIso,
        rejection_reason: null,
      })
      .eq('connection_id', connectionId)
      .eq('confirmation_status', 'pending');
    if (error) return fail(error.message, 'DB_ERROR', 500);

    scheduleTelegramDispatch();
    return { success: true, connectionId, confirmationStatus: 'confirmed', sellerPhone: conn.seller_phone };
  }

  if (reason.length < 3) {
    return fail('Укажите причину отклонения (не менее 3 символов)', 'REJECTION_REASON_REQUIRED', 422);
  }

  const { error: rejectErr } = await admin
    .from('connections')
    .update({
      confirmation_status: 'rejected',
      rejection_reason: reason.slice(0, 500),
      confirmed_by: actor.user_id,
      confirmed_at: nowIso,
    })
    .eq('connection_id', connectionId)
    .eq('confirmation_status', 'pending');
  if (rejectErr) return fail(rejectErr.message, 'DB_ERROR', 500);

  // Привязанный лид возвращается в «Назначен», куратор у продавца снимается
  const { data: linkedLead } = await admin
    .from('leads')
    .select('lead_id')
    .eq('seller_phone', conn.seller_phone)
    .maybeSingle();
  if (linkedLead) {
    const { error: unlinkErr } = await (admin.rpc as any)('unlink_lead_and_seller', { p_lead_id: linkedLead.lead_id });
    if (unlinkErr) console.error('[setConnectionConfirmation] unlink_lead_and_seller:', unlinkErr);
  }
  await admin
    .from('sellers')
    .update({ manager_id: null })
    .eq('seller_phone', conn.seller_phone)
    .eq('manager_id', conn.manager_id);

  scheduleTelegramDispatch();
  return { success: true, connectionId, confirmationStatus: 'rejected', sellerPhone: conn.seller_phone };
}
