import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { LeadCreateSchema, normalizeNullableUuid } from '@/lib/validations';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assigned_to');
    const sortBy = searchParams.get('sort_by') || 'created_at';
    const sortOrder = searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';

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

    // Ролевая изоляция
    if (profile.role === 'consultant') {
      query = query
        .eq('assigned_to', profile.user_id)
        .in('status', ['Назначен', 'Подписан', 'Отмена']);
    } else if (profile.role === 'smm') {
      query = query.eq('created_by', profile.user_id);
    }

    // Фильтр по статусу воронки
    if (status && status !== 'all' && status !== 'Все') {
      query = query.eq('status', status as any);
    }

    // Фильтр по куратору
    if (assignedTo && assignedTo !== 'all') {
      if (assignedTo === 'unassigned') {
        query = query.is('assigned_to', null);
      } else {
        query = query.eq('assigned_to', assignedTo);
      }
    }

    // Поиск
    if (search.trim()) {
      const q = search.trim();
      query = query.or(
        `client_name.ilike.%${q}%,phone.ilike.%${q}%,comment.ilike.%${q}%,instagram.ilike.%${q}%`
      );
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    query = query.order(sortBy, { ascending: sortOrder === 'asc' }).range(from, to);

    const { data: leads, count, error } = await query;
    if (error) throw error;

    return apiSuccess({
      items: leads || [],
      total: count || 0,
      page,
      limit,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    if (profile.role === 'consultant') {
      return apiError('Консультанты не имеют прав на создание лидов', 'FORBIDDEN', 403);
    }

    const body = await req.json();

    const sanitizedInput = {
      ...body,
      assigned_to: normalizeNullableUuid(body.assigned_to),
      country_code:
        body.country_code && body.country_code.trim() !== ''
          ? body.country_code.trim()
          : '996',
      instagram:
        body.instagram && body.instagram.trim() !== ''
          ? body.instagram.trim()
          : null,
      comment:
        body.comment && body.comment.trim() !== ''
          ? body.comment.trim()
          : null,
    };

    const parsed = LeadCreateSchema.safeParse(sanitizedInput);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Ошибка валидации данных лида',
        'VALIDATION_ERROR',
        422,
        parsed.error.issues
      );
    }

    const valid = parsed.data;
    const cleanPhone = valid.phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 6) {
      return apiError('Укажите корректный номер телефона (минимум 6 цифр)', 'INVALID_PHONE', 422);
    }

    const phoneWithoutCode =
      cleanPhone.startsWith('996') && cleanPhone.length > 9
        ? cleanPhone.substring(3)
        : cleanPhone;

    let finalAssignedTo = valid.assigned_to;
    if (profile.role === 'smm') {
      finalAssignedTo = null;
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

    if (error) throw error;

    return apiSuccess(newLead, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
