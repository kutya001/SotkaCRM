import { NextRequest } from 'next/server';
import { z } from 'zod';
import { PG_UUID_REGEX } from '@/lib/validations';
import { revalidatePath, revalidateTag } from 'next/cache';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

/**
 * Массовые операции над сотрудниками:
 * { action: 'set_active', ids, is_active }  — employees.deactivate
 * { action: 'set_role',   ids, role_id }    — employees.edit (как и смена роли в одиночном PATCH)
 * Собственный аккаунт вызывающего никогда не отключается (id возвращается в skipped).
 * Ответ: { success: true, updated, skipped }
 */
const BatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_active'),
    ids: z.array(z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника')).min(1, 'Выберите хотя бы одного сотрудника').max(500),
    is_active: z.boolean({ message: 'Не указан флаг активности' }),
  }),
  z.object({
    action: z.literal('set_role'),
    ids: z.array(z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника')).min(1, 'Выберите хотя бы одного сотрудника').max(500),
    role_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор роли'),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('employees.edit');
    const body = await req.json();

    const parsed = BatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Ошибка валидации массовой операции',
        'VALIDATION_ERROR',
        422,
        parsed.error.issues
      );
    }

    const admin = createAdminClient();
    const input = parsed.data;
    const uniqueIds = Array.from(new Set(input.ids));
    const skipped: string[] = [];

    if (input.action === 'set_active') {
      if (!ctx.can('employees.deactivate')) {
        return apiError('Недостаточно прав: отключать и включать аккаунты сотрудников', 'FORBIDDEN', 403);
      }

      // Собственный аккаунт отключать нельзя
      const ids = uniqueIds.filter((id) => {
        if (!input.is_active && id === ctx.profile.user_id) {
          skipped.push(id);
          return false;
        }
        return true;
      });

      let updated = 0;
      if (ids.length > 0) {
        const { data, error } = await admin
          .from('users')
          .update({ is_active: input.is_active })
          .in('user_id', ids)
          .select('user_id');
        if (error) throw error;
        updated = data?.length || 0;
      }

      revalidateTag('employees');
      revalidatePath('/employees');
      return apiSuccess({ success: true, updated, skipped });
    }

    if (input.action === 'set_role') {
      const { data: role, error: roleErr } = await admin
        .from('roles')
        .select('role_id')
        .eq('role_id', input.role_id)
        .maybeSingle();
      if (roleErr) throw roleErr;
      if (!role) {
        return apiError('Роль не найдена', 'NOT_FOUND', 404);
      }

      // Триггер trg_users_sync_role синхронизирует устаревший enum role из role_id
      const { data, error } = await admin
        .from('users')
        .update({ role_id: input.role_id })
        .in('user_id', uniqueIds)
        .select('user_id, auth_id, full_name, role');
      if (error) throw error;

      // Синхронизация user_metadata в auth.users (как в одиночном обновлении), ошибки не критичны
      for (const u of data || []) {
        if (!u.auth_id) continue;
        try {
          await admin.auth.admin.updateUserById(u.auth_id, {
            user_metadata: { full_name: u.full_name, role: u.role },
          });
        } catch (metaErr) {
          console.warn('Предупреждение синхронизации auth metadata:', metaErr);
        }
      }

      revalidateTag('employees');
      revalidatePath('/employees');
      return apiSuccess({ success: true, updated: data?.length || 0, skipped });
    }

    return apiError('Неизвестное действие', 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
