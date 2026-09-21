'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/check-role';
import { LeadCreateSchema, normalizeNullableUuid } from '@/lib/validations';
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { leads: [], totalCount: 0 };
  }

  // Получаем текущего пользователя CRM
  const { data: currentProfile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  const {
    page = 1,
    pageSize = 1000,
    search = '',
    status,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

    let query = supabase
      .from('leads')
      .select(
        `
          *,
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

    // Очистка телефона от лишних символов (хранятся строго цифры)
    const cleanPhone = valid.phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 6) {
      return {
        success: false,
        error: 'Укажите корректный номер телефона (минимум 6 цифр)',
      };
    }

    // Если номер указан с кодом 996 (12 цифр), отсекаем его для унификации хранения
    const phoneWithoutCode =
      cleanPhone.startsWith('996') && cleanPhone.length > 9
        ? cleanPhone.substring(3)
        : cleanPhone;

    // Инвариант назначения ответственного:
    // 1. Для SMM куратор не назначается (заполняется администратором при переводе в «Назначен»)
    // 2. Для консультанта лид ВСЕГДА закрепляется за ним
    // 3. Для администратора лид назначается на выбранного консультанта (или остается null)
    let finalAssignedTo = valid.assigned_to;
    if (profile.role === 'smm') {
      finalAssignedTo = null;
    } else if (profile.role === 'consultant') {
      finalAssignedTo = profile.user_id;
    }

    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        client_name: valid.client_name.trim(),
        phone: phoneWithoutCode,
        country_code: valid.country_code || '996',
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

    // RBAC: Проверка прав доступа и валидация статусов перед изменением
    const { data: targetLead } = await supabase
      .from('leads')
      .select('created_by, assigned_to, status')
      .eq('lead_id', leadId)
      .single();

    if (!targetLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    if (profile.role === 'smm') {
      if (targetLead.created_by !== profile.user_id) {
        return { success: false, error: 'Роль SMM может редактировать только созданные собой лиды' };
      }
      if (targetLead.status !== 'Открыт' && targetLead.status !== 'Обработан') {
        return {
          success: false,
          error: 'SMM-специалист не может изменять лид на этапе «Назначен», «Подписан» или «Отмена»',
        };
      }
      if (updates.status && updates.status !== 'Открыт' && updates.status !== 'Обработан') {
        return {
          success: false,
          error: 'SMM-специалисту доступен перевод только между статусами «Открыт» и «Обработан»',
        };
      }
      // SMM не имеет прав назначать ответственного
      updates.assigned_to = undefined;
    } else if (profile.role === 'consultant') {
      if (targetLead.assigned_to !== profile.user_id) {
        return { success: false, error: 'Лид назначен на другого консультанта' };
      }
      if (!['Назначен', 'Подписан', 'Отмена'].includes(targetLead.status)) {
        return {
          success: false,
          error: 'Консультанту доступны только лиды в статусах «Назначен», «Подписан» или «Отмена»',
        };
      }
      if (updates.status && !['Назначен', 'Подписан', 'Отмена'].includes(updates.status)) {
        return {
          success: false,
          error: 'Консультант может переводить статус только в «Назначен», «Подписан» или «Отмена»',
        };
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
      if (updates.country_code !== undefined) payload.country_code = updates.country_code;
      if (updates.instagram !== undefined) {
        payload.instagram = updates.instagram && updates.instagram.trim() !== '' ? updates.instagram.trim() : null;
      }
      if (updates.comment !== undefined) {
        payload.comment = updates.comment && updates.comment.trim() !== '' ? updates.comment.trim() : null;
      }
      if (updates.assigned_to !== undefined && profile.role === 'admin') {
        payload.assigned_to = normalizeNullableUuid(updates.assigned_to);
      }
      if (updates.status !== undefined) payload.status = updates.status;

      if (updates.phone !== undefined) {
        const cleanPhone = updates.phone.replace(/\D/g, '');
        payload.phone =
          cleanPhone.startsWith('996') && cleanPhone.length > 9
            ? cleanPhone.substring(3)
            : cleanPhone;
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

    if (profile.role === 'smm') {
      if (targetLead.created_by !== profile.user_id) {
        return { success: false, error: 'Роль SMM может управлять только созданными собой лидами' };
      }
      if (!['Открыт', 'Обработан'].includes(targetLead.status) || !['Открыт', 'Обработан'].includes(status)) {
        return {
          success: false,
          error: 'SMM-специалисту доступен перевод только между статусами «Открыт» и «Обработан»',
        };
      }
    } else if (profile.role === 'consultant') {
      if (targetLead.assigned_to !== profile.user_id) {
        return { success: false, error: 'Лид назначен на другого консультанта' };
      }
      if (!['Назначен', 'Подписан', 'Отмена'].includes(status)) {
        return {
          success: false,
          error: 'Консультант может переводить статус только в «Назначен», «Подписан» или «Отмена»',
        };
      }
    }

    const { error } = await supabase
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

    revalidatePath('/leads');
    return { success: true };
  } catch (err: any) {
    console.error('Unhandled error in updateLeadStatus:', err);
    return { success: false, error: err?.message || 'Не удалось обновить статус' };
  }
}

/**
 * Перевод лида в статус «Отмена» с сохранением причины
 * ВНИМАНИЕ: Физический вызов delete() строго запрещен триггером prevent_lead_delete!
 */
export async function cancelLead(
  leadId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { profile, supabase } = await requireAuth();

    if (profile.role === 'smm') {
      return { success: false, error: 'Роль SMM не имеет прав на отмену сделки' };
    }

    // Получаем текущий комментарий лида и проверяем права
    const { data: currentLead } = await supabase
      .from('leads')
      .select('assigned_to, comment')
      .eq('lead_id', leadId)
      .single();

    if (!currentLead) {
      return { success: false, error: 'Лид не найден в системе' };
    }

    if (
      profile.role === 'consultant' &&
      currentLead.assigned_to &&
      currentLead.assigned_to !== profile.user_id
    ) {
      return { success: false, error: 'Лид назначен на другого консультанта' };
    }

    const now = new Date().toLocaleDateString('ru-RU');
    const cancellationNote = `[Отмена (${now})]: ${reason.trim()}`;
    const updatedComment = currentLead?.comment
      ? `${currentLead.comment}\n${cancellationNote}`
      : cancellationNote;

    const { error } = await supabase
      .from('leads')
      .update({
        status: 'Отмена',
        comment: updatedComment,
        updated_at: new Date().toISOString(),
      })
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
  const supabase = await createClient();

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
  const supabase = await createClient();

  // Попытка получить предвычисленные агрегаты через SQL-функцию get_leads_funnel_stats (миграция 003)
  try {
    const { data: rpcStats, error: rpcError } = await supabase.rpc('get_leads_funnel_stats');
    if (!rpcError && rpcStats) {
      return {
        total: Number(rpcStats.total) || 0,
        open: Number(rpcStats.open) || 0,
        processed: Number(rpcStats.processed) || 0,
        assigned: Number(rpcStats.assigned) || 0,
        signed: Number(rpcStats.signed) || 0,
        cancelled: Number(rpcStats.cancelled) || 0,
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
