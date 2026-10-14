'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { CancelReasonSchema, LeadCreateSchema, normalizeNullableUuid } from '@/lib/validations';
import {
  canAssignLead,
  canChangeLeadStatus,
  canEditLeadComment,
  canEditLeadFields,
  implicitStatusForAssignment,
  isCancelStatus,
  isLeadInScope,
  leadActorFrom,
} from '@/lib/leads/status-rules';
import {
  DEFAULT_COUNTRY_CODE,
  digitsOnly,
  findPhoneCountry,
  isKnownCountryCode,
  isValidNational,
  normalizeNational,
} from '@/lib/utils/phone';
import type { Database, LeadStatus } from '@/types/database.types';

export interface LeadItem {
  lead_id: string;
  created_at: string;
  client_name: string;
  phone: string;
  country_code: string;
  status: LeadStatus;
  instagram: string | null;
  comment: string | null;
  created_by: string;
  assigned_to: string | null;
  seller_phone: string | null;
  linked_at: string | null;
  updated_at: string;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  assigned_user?: {
    user_id: string;
    full_name: string;
    role: string;
    color?: string;
  } | null;
  created_user?: {
    user_id: string;
    full_name: string;
    role: string;
    color?: string;
  } | null;
}

export interface GetLeadsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface LeadsResponse {
  leads: LeadItem[];
  totalCount: number;
  /** Базовая роль (устаревший enum) — только как данные для интерфейса */
  currentUserRole?: string;
  currentUserId?: string;
  /** Права назначенной роли («*» — полный доступ) для правил lib/leads/status-rules на клиенте */
  currentUserPermissions?: string[];
}

const EMPTY_STATS = {
  total: 0,
  open: 0,
  processed: 0,
  assigned: 0,
  signed: 0,
  cancelled: 0,
};

/**
 * Получение списка лидов с обогащением данных ответственных и авторов
 */
export async function getLeads(params: GetLeadsParams = {}): Promise<LeadsResponse> {
  let authCtx;
  try {
    authCtx = await requireAuth();
  } catch {
    return { leads: [], totalCount: 0 };
  }
  const { profile: currentProfile, permissions, can, canViewAll } = authCtx;

  if (!can('leads.menu')) {
    return {
      leads: [],
      totalCount: 0,
      currentUserRole: currentProfile.role,
      currentUserId: currentProfile.user_id,
      currentUserPermissions: permissions,
    };
  }

  const {
    page = 1,
    pageSize = 50,
    search = '',
    status,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  let query = createAdminClient()
    .from('leads')
    .select(
      `
        lead_id,
        client_name,
        phone,
        country_code,
        status,
        instagram,
        comment,
        created_by,
        assigned_to,
        seller_phone,
        linked_at,
        created_at,
        updated_at,
        assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color),
        created_user:users!leads_created_by_fkey(user_id, full_name, role, color)
      `,
      { count: 'exact' }
    );

  // Область данных: без «leads.view_all» — только свои лиды (назначенные мне или созданные мной)
  if (!canViewAll('leads')) {
    query = query.or(`assigned_to.eq.${currentProfile.user_id},created_by.eq.${currentProfile.user_id}`);
  }

  // Фильтрация по статусу
  if (status && status !== 'Все') {
    query = query.eq('status', status as LeadStatus);
  }

  // Поиск по имени, телефону или комментарию
  if (search.trim()) {
    const cleanSearch = search.trim();
    query = query.or(
      `client_name.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%,comment.ilike.%${cleanSearch}%`
    );
  }

  // Сортировка
  const isAscending = sortOrder === 'asc';
  query = query.order(sortBy, { ascending: isAscending });

  // Пагинация
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    console.error('Error fetching leads:', error);
    return { leads: [], totalCount: 0 };
  }

  return {
    leads: (data as unknown as LeadItem[]) || [],
    totalCount: count || 0,
    currentUserRole: currentProfile.role,
    currentUserId: currentProfile.user_id,
    currentUserPermissions: permissions,
  };
}

/**
 * Создание нового лида
 */
export async function createLead(input: {
  client_name: string;
  phone: string;
  country_code?: string;
  instagram?: string;
  comment?: string;
  assigned_to?: string | null;
}): Promise<{ success: boolean; error?: string; lead?: LeadItem }> {
  try {
    const { profile, can } = await requireAuth();

    if (!can('leads.create')) {
      return { success: false, error: 'Недостаточно прав для создания лидов' };
    }

    // Санитизация пустых строк для опциональных полей перед валидацией
    const sanitizedInput = {
      ...input,
      assigned_to: normalizeNullableUuid(input.assigned_to),
      country_code:
        input.country_code && input.country_code.trim() !== ''
          ? input.country_code.trim()
          : '996',
      instagram:
        input.instagram && input.instagram.trim() !== ''
          ? input.instagram.trim()
          : null,
      comment:
        input.comment && input.comment.trim() !== ''
          ? input.comment.trim()
          : null,
    };

    const parsed = LeadCreateSchema.safeParse(sanitizedInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || 'Ошибка валидации полей',
      };
    }

    const valid = parsed.data;

    // Национальный номер без кода страны (длина проверена схемой по коду страны)
    const countryCode = digitsOnly(valid.country_code) || DEFAULT_COUNTRY_CODE;
    const phoneWithoutCode = normalizeNational(valid.phone, countryCode);

    // Инвариант назначения ответственного: без права «leads.assign» консультант не выбирается
    // (лид остается без ответственного), кроме назначения на самого себя
    let finalAssignedTo = valid.assigned_to || null;
    if (!can('leads.assign') && finalAssignedTo !== profile.user_id) {
      finalAssignedTo = null;
    }

    const { data: newLead, error } = await createAdminClient()
      .from('leads')
      .insert({
        client_name: valid.client_name.trim(),
        phone: phoneWithoutCode,
        country_code: countryCode,
        status: 'Открыт',
        instagram: valid.instagram || null,
        comment: valid.comment || null,
        created_by: profile.user_id,
        assigned_to: finalAssignedTo,
      })
      .select(
        `
          *,
          assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color),
          created_user:users!leads_created_by_fkey(user_id, full_name, role, color)
        `
      )
      .single();

    if (error) {
      console.error('Error creating lead:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/leads');
    return { success: true, lead: newLead as unknown as LeadItem };
  } catch (err: any) {
    console.error('Unhandled error in createLead:', err);
    return { success: false, error: err?.message || 'Не удалось создать лид' };
  }
}

/**
 * Обновление полей карточки лида
 */
export async function updateLead(
  leadId: string,
  updates: {
    client_name?: string;
    phone?: string;
    country_code?: string;
    instagram?: string | null;
    comment?: string | null;
    assigned_to?: string | null;
    status?: LeadStatus;
  }
): Promise<{ success: boolean; error?: string; lead?: LeadItem }> {
  try {
    const ctx = await requireAuth();
    const actor = leadActorFrom(ctx);
    const admin = createAdminClient();

    // RBAC: единые правила по правам (lib/leads/status-rules)
    const { data: targetLead } = await admin
      .from('leads')
      .select('created_by, assigned_to, status, country_code')
      .eq('lead_id', leadId)
      .single();

    if (!targetLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    if (!isLeadInScope(actor, targetLead)) {
      return { success: false, error: 'Лид вне вашей области видимости' };
    }

    const fullEdit = canEditLeadFields(actor, targetLead);
    const commentEdit = canEditLeadComment(actor, targetLead);
    const wantsFieldEdit =
      updates.client_name !== undefined ||
      updates.phone !== undefined ||
      updates.country_code !== undefined ||
      updates.instagram !== undefined;
    const wantsReassign =
      updates.assigned_to !== undefined &&
      normalizeNullableUuid(updates.assigned_to) !== (targetLead.assigned_to ?? null);
    const wantsStatusChange = updates.status !== undefined && updates.status !== targetLead.status;

    if (wantsFieldEdit && !fullEdit) {
      return { success: false, error: 'Недостаточно прав для редактирования карточки лида' };
    }
    if (updates.comment !== undefined && !commentEdit) {
      return { success: false, error: 'Недостаточно прав для редактирования комментария лида' };
    }
    if (wantsReassign && !canAssignLead(actor)) {
      return { success: false, error: 'Недостаточно прав для назначения ответственного' };
    }
    if (wantsStatusChange) {
      const check = canChangeLeadStatus(actor, targetLead, updates.status as LeadStatus);
      if (!check.ok) return { success: false, error: check.reason };
      if (isCancelStatus(updates.status)) {
        return { success: false, error: 'Для отмены лида используйте действие «Отменить» с указанием причины' };
      }
    }
    if (!fullEdit && !commentEdit && !wantsReassign && !wantsStatusChange) {
      return { success: false, error: 'Недостаточно прав для редактирования этого лида' };
    }

    const payload: Database['public']['Tables']['leads']['Update'] = {
      updated_at: new Date().toISOString(),
    };

    if (updates.comment !== undefined) {
      payload.comment = updates.comment && updates.comment.trim() !== '' ? updates.comment.trim() : null;
    }

    if (fullEdit) {
      if (updates.client_name !== undefined) payload.client_name = updates.client_name.trim();
      if (updates.instagram !== undefined) {
        payload.instagram = updates.instagram && updates.instagram.trim() !== '' ? updates.instagram.trim() : null;
      }

      if (updates.phone !== undefined || updates.country_code !== undefined) {
        const countryCode = digitsOnly(updates.country_code ?? targetLead.country_code) || DEFAULT_COUNTRY_CODE;
        if (!isKnownCountryCode(countryCode)) {
          return { success: false, error: 'Неизвестный код страны' };
        }
        payload.country_code = countryCode;
        if (updates.phone !== undefined) {
          const national = normalizeNational(updates.phone, countryCode);
          if (!isValidNational(national, countryCode)) {
            const country = findPhoneCountry(countryCode);
            return {
              success: false,
              error: `Номер для +${countryCode} должен содержать ${country?.nationalLength ?? 9} цифр без кода страны`,
            };
          }
          payload.phone = national;
        }
      }
    }

    if (wantsReassign) {
      payload.assigned_to = normalizeNullableUuid(updates.assigned_to);
      const implicit = implicitStatusForAssignment(targetLead.status, payload.assigned_to);
      if (implicit && !wantsStatusChange) payload.status = implicit;
    }

    if (wantsStatusChange) payload.status = updates.status;

    const { data, error } = await admin
      .from('leads')
      .update(payload)
      .eq('lead_id', leadId)
      .select(
        `
          *,
          assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color),
          created_user:users!leads_created_by_fkey(user_id, full_name, role, color)
        `
      )
      .single();

    if (error) {
      console.error('Error updating lead:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/leads');
    return { success: true, lead: data as unknown as LeadItem };
  } catch (err: any) {
    console.error('Unhandled error in updateLead:', err);
    return { success: false, error: err?.message || 'Не удалось обновить лид' };
  }
}

/**
 * Экспресс-смена статуса лида
 */
export async function updateLeadStatus(
  leadId: string,
  status: LeadStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireAuth();
    const admin = createAdminClient();

    const { data: targetLead } = await admin
      .from('leads')
      .select('created_by, assigned_to, status')
      .eq('lead_id', leadId)
      .single();

    if (!targetLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    const check = canChangeLeadStatus(leadActorFrom(ctx), targetLead, status);
    if (!check.ok) {
      return { success: false, error: check.reason };
    }
    if (isCancelStatus(status)) {
      return { success: false, error: 'Для отмены лида укажите причину (действие «Отменить»)' };
    }

    // Запись сервисным клиентом: права проверены правилами, RLS — страховка
    const { error } = await admin
      .from('leads')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', leadId);

    if (error) {
      console.error('Error updating lead status:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Unhandled error in updateLeadStatus:', err);
    return { success: false, error: err?.message || 'Не удалось обновить статус' };
  }
}

/**
 * Перевод лида в статус «Отмена» с обязательной причиной (колонка cancel_reason, миграция 037)
 * ВНИМАНИЕ: Физический вызов delete() строго запрещен триггером prevent_lead_delete!
 */
export async function cancelLead(
  leadId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireAuth();
    const admin = createAdminClient();

    const parsedReason = CancelReasonSchema.safeParse(reason ?? '');
    if (!parsedReason.success) {
      return { success: false, error: parsedReason.error.issues[0]?.message || 'Укажите причину отмены' };
    }

    const { data: currentLead } = await admin
      .from('leads')
      .select('created_by, assigned_to, status')
      .eq('lead_id', leadId)
      .single();

    if (!currentLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    const check = canChangeLeadStatus(leadActorFrom(ctx), currentLead, 'Отмена');
    if (!check.ok) {
      return { success: false, error: check.reason };
    }

    const { error } = await admin
      .from('leads')
      .update({
        status: 'Отмена',
        cancel_reason: parsedReason.data,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('lead_id', leadId);

    if (error) {
      console.error('Error cancelling lead:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/leads');
    return { success: true };
  } catch (err: any) {
    console.error('Unhandled error in cancelLead:', err);
    return { success: false, error: err?.message || 'Не удалось отменить сделку' };
  }
}

/**
 * Получение списка активных консультантов и администраторов (кандидаты в ответственные)
 */
export async function getConsultantsList(): Promise<
  { user_id: string; full_name: string; role: string; login: string; color?: string }[]
> {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx) return [];

  const { data, error } = await createAdminClient()
    .from('users')
    .select('user_id, full_name, role, login, color')
    .eq('is_active', true)
    .in('role', ['admin', 'consultant'])
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error fetching consultants:', error);
    return [];
  }

  return (data as any) || [];
}

/**
 * Сводная статистика по статусам воронки
 */
export async function getLeadsStats() {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx || !authCtx.can('leads.menu')) {
    return { ...EMPTY_STATS };
  }
  const { supabase, profile, canViewAll } = authCtx;

  // Попытка получить предвычисленные агрегаты через SQL-функцию get_leads_funnel_stats (миграция 003):
  // RPC сама ограничивает область по auth.uid(), поэтому вызывается клиентом пользователя
  try {
    const { data: rpcStats, error: rpcError } = await supabase.rpc('get_leads_funnel_stats');
    if (!rpcError && rpcStats) {
      const stats = rpcStats as Record<string, any>;
      return {
        total: Number(stats.total) || 0,
        open: Number(stats.open) || 0,
        processed: Number(stats.processed) || 0,
        assigned: Number(stats.assigned) || 0,
        signed: Number(stats.signed) || 0,
        cancelled: Number(stats.cancelled) || 0,
      };
    }
  } catch (rpcErr) {
    console.warn('RPC get_leads_funnel_stats недоступен, fallback на агрегацию в памяти:', rpcErr);
  }

  let query = createAdminClient().from('leads').select('status');
  if (!canViewAll('leads')) {
    query = query.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
  }

  const { data, error } = await query;

  if (error || !data) {
    return { ...EMPTY_STATS };
  }

  return {
    total: data.length,
    open: data.filter((l) => l.status === 'Открыт').length,
    processed: data.filter((l) => l.status === 'Обработан').length,
    assigned: data.filter((l) => l.status === 'Назначен').length,
    signed: data.filter((l) => l.status === 'Подписан').length,
    cancelled: data.filter((l) => l.status === 'Отмена').length,
  };
}

/**
 * Быстрое назначение/переназначение ответственного консультанта (право «leads.assign»)
 * Поддерживает сброс консультанта (null) с возвратом статуса в "Обработан"
 */
export async function assignLeadConsultant(
  leadId: string,
  consultantId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireAuth();
    const actor = leadActorFrom(ctx);
    const admin = createAdminClient();

    if (!canAssignLead(actor)) {
      return { success: false, error: 'Недостаточно прав для назначения ответственного' };
    }

    const { data: currentLead } = await admin
      .from('leads')
      .select('status, created_by, assigned_to')
      .eq('lead_id', leadId)
      .single();

    if (!currentLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    if (!isLeadInScope(actor, currentLead)) {
      return { success: false, error: 'Лид вне вашей области видимости' };
    }

    const updates: Database['public']['Tables']['leads']['Update'] = {
      assigned_to: consultantId || null,
      updated_at: new Date().toISOString(),
    };

    // Назначение из «Открыт»/«Обработан» → «Назначен»; снятие из «Назначен» → «Обработан»
    const implicit = implicitStatusForAssignment(currentLead.status, consultantId);
    if (implicit) updates.status = implicit;

    const { error } = await admin
      .from('leads')
      .update(updates)
      .eq('lead_id', leadId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/leads');
    revalidatePath('/analytics');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
