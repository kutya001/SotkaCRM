'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { CancelReasonSchema, LeadCreateSchema, normalizeNullableUuid } from '@/lib/validations';
import {
  canChangeLeadStatus,
  canEditLeadFields,
  implicitStatusForAssignment,
  isCancelStatus,
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
  currentUserRole?: string;
  currentUserId?: string;
}

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
  const { profile: currentProfile, supabase } = authCtx;

  const {
    page = 1,
    pageSize = 50,
    search = '',
    status,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

    let query = supabase
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

    // СТРОГАЯ ИЗОЛЯЦИЯ: Консультант видит только свои назначенные лиды в статусах Назначен, Подписан, Отмена
    if (currentProfile?.role === 'consultant') {
      query = query
        .eq('assigned_to', currentProfile.user_id)
        .in('status', ['Назначен', 'Подписан', 'Отмена']);
    } else if (currentProfile?.role === 'smm') {
      query = query.eq('created_by', currentProfile.user_id);
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
    currentUserRole: currentProfile?.role,
    currentUserId: currentProfile?.user_id,
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
    const { profile, supabase } = await requireAuth();

    if (profile.role !== 'admin' && profile.role !== 'smm') {
      return {
        success: false,
        error: 'Добавлять лиды могут администратор и SMM-специалист',
      };
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

    // Инвариант назначения ответственного:
    // 1. Для SMM куратор не назначается (заполняется администратором при переводе в «Назначен»)
    // 2. Для администратора лид назначается на выбранного консультанта (или остается null)
    let finalAssignedTo = valid.assigned_to;
    if (profile.role === 'smm') {
      finalAssignedTo = null;
    }

    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        client_name: valid.client_name.trim(),
        phone: phoneWithoutCode,
        country_code: countryCode,
        status: 'Открыт',
        instagram: valid.instagram || null,
        comment: valid.comment || null,
        created_by: profile.user_id,
        assigned_to: finalAssignedTo || null,
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
    const { profile, supabase } = await requireAuth();

    // RBAC: единая матрица ролей (lib/leads/status-rules)
    const { data: targetLead } = await supabase
      .from('leads')
      .select('created_by, assigned_to, status, country_code')
      .eq('lead_id', leadId)
      .single();

    if (!targetLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    if (!canEditLeadFields(profile.role, targetLead, profile.user_id)) {
      return { success: false, error: 'Недостаточно прав для редактирования этого лида' };
    }

    if (updates.status !== undefined && updates.status !== targetLead.status) {
      const check = canChangeLeadStatus(profile.role, targetLead, profile.user_id, updates.status);
      if (!check.ok) return { success: false, error: check.reason };
      if (isCancelStatus(updates.status)) {
        return { success: false, error: 'Для отмены лида используйте действие «Отменить» с указанием причины' };
      }
    }

    const payload: Database['public']['Tables']['leads']['Update'] = {
      updated_at: new Date().toISOString(),
    };

    // Консультант имеет право изменять ТОЛЬКО статус и комментарий
    if (profile.role === 'consultant') {
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.comment !== undefined) {
        payload.comment = updates.comment && updates.comment.trim() !== '' ? updates.comment.trim() : null;
      }
    } else {
      // Администратор и SMM (с учетом проверок выше)
      if (updates.client_name !== undefined) payload.client_name = updates.client_name.trim();
      if (updates.instagram !== undefined) {
        payload.instagram = updates.instagram && updates.instagram.trim() !== '' ? updates.instagram.trim() : null;
      }
      if (updates.comment !== undefined) {
        payload.comment = updates.comment && updates.comment.trim() !== '' ? updates.comment.trim() : null;
      }
      if (updates.assigned_to !== undefined && profile.role === 'admin') {
        payload.assigned_to = normalizeNullableUuid(updates.assigned_to);
        const implicit = implicitStatusForAssignment(targetLead.status, payload.assigned_to);
        if (implicit && updates.status === undefined) payload.status = implicit;
      }
      if (updates.status !== undefined) payload.status = updates.status;

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

    const { data, error } = await supabase
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
    const { profile, supabase } = await requireAuth();

    const { data: targetLead } = await supabase
      .from('leads')
      .select('created_by, assigned_to, status')
      .eq('lead_id', leadId)
      .single();

    if (!targetLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    const check = canChangeLeadStatus(profile.role, targetLead, profile.user_id, status);
    if (!check.ok) {
      return { success: false, error: check.reason };
    }
    if (isCancelStatus(status)) {
      return { success: false, error: 'Для отмены лида укажите причину (действие «Отменить»)' };
    }

    // Запись сервисным клиентом: права проверены матрицей ролей, RLS — страховка
    const { error } = await createAdminClient()
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
    const { profile, supabase } = await requireAuth();

    const parsedReason = CancelReasonSchema.safeParse(reason ?? '');
    if (!parsedReason.success) {
      return { success: false, error: parsedReason.error.issues[0]?.message || 'Укажите причину отмены' };
    }

    const { data: currentLead } = await supabase
      .from('leads')
      .select('created_by, assigned_to, status')
      .eq('lead_id', leadId)
      .single();

    if (!currentLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    const check = canChangeLeadStatus(profile.role, currentLead, profile.user_id, 'Отмена');
    if (!check.ok) {
      return { success: false, error: check.reason };
    }

    const { error } = await createAdminClient()
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
 * Получение списка активных консультантов и администраторов
 */
export async function getConsultantsList(): Promise<
  { user_id: string; full_name: string; role: string; login: string; color?: string }[]
> {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx) return [];
  const { supabase } = authCtx;

  const { data, error } = await supabase
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
  if (!authCtx) {
    return {
      total: 0,
      open: 0,
      processed: 0,
      assigned: 0,
      signed: 0,
      cancelled: 0,
    };
  }
  const { supabase } = authCtx;

  // Попытка получить предвычисленные агрегаты через SQL-функцию get_leads_funnel_stats (миграция 003)
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

  const { data, error } = await supabase
    .from('leads')
    .select('status');

  if (error || !data) {
    return {
      total: 0,
      open: 0,
      processed: 0,
      assigned: 0,
      signed: 0,
      cancelled: 0,
    };
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
 * Быстрое назначение/переназначение ответственного консультанта администратором
 * Поддерживает сброс консультанта (null) с возвратом статуса в "Обработан"
 */
export async function assignLeadConsultant(
  leadId: string,
  consultantId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const { profile, supabase } = await requireAuth();

    if (profile.role !== 'admin') {
      return { success: false, error: 'Переназначение консультантов доступно только администратору' };
    }

    const { data: currentLead } = await supabase
      .from('leads')
      .select('status')
      .eq('lead_id', leadId)
      .single();

    const updates: Database['public']['Tables']['leads']['Update'] = {
      assigned_to: consultantId || null,
      updated_at: new Date().toISOString(),
    };

    // Если консультант назначен и статус был Открыт или Обработан, автоматически переводим в Назначен
    if (consultantId && currentLead && (currentLead.status === 'Открыт' || currentLead.status === 'Обработан')) {
      updates.status = 'Назначен';
    }

    // Если консультанта сбросили (null) и статус был Назначен, возвращаем в Обработан
    if (!consultantId && currentLead && currentLead.status === 'Назначен') {
      updates.status = 'Обработан';
    }

    const { error } = await supabase
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
