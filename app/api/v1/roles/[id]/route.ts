import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { listRoles, normalizePermissions, replaceRolePermissions } from '@/lib/services/roles';

const RoleUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Название роли — минимум 2 символа').max(60, 'Название роли — не длиннее 60 символов').optional(),
  description: z.string().trim().max(300, 'Описание — не длиннее 300 символов').nullable().optional(),
  base_role: z.enum(['admin', 'supervisor', 'consultant', 'smm']).optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * PATCH /api/v1/roles/[id] — название, описание, базовый профиль и набор прав
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission('employees.roles');
    const { id } = await params;
    const body = RoleUpdateSchema.parse(await req.json());
    const admin = createAdminClient();

    const { data: role, error: findErr } = await admin.from('roles').select('*').eq('role_id', id).single();
    if (findErr || !role) return apiError('Роль не найдена', 'NOT_FOUND', 404);

    const updates: { name?: string; description?: string | null; base_role?: 'admin' | 'supervisor' | 'consultant' | 'smm' } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.base_role !== undefined) {
      if (role.is_admin && body.base_role !== 'admin') {
        return apiError('У роли с полным доступом базовый профиль всегда «Администратор»', 'ADMIN_ROLE_LOCKED', 422);
      }
      updates.base_role = body.base_role;
    }

    if (body.permissions !== undefined && !role.is_admin) {
      const perms = normalizePermissions(body.permissions);
      // Нельзя лишить собственную роль права управлять ролями — иначе редактор станет недоступен
      if (ctx.profile.role_id === role.role_id && !perms.includes('employees.roles')) {
        return apiError('Нельзя снять право «Управлять ролями и доступами» со своей роли', 'SELF_LOCKOUT', 422);
      }
      await replaceRolePermissions(role.role_id, perms);
    }

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await admin.from('roles').update(updates).eq('role_id', id);
      if (updErr) throw updErr;
    }

    const roles = await listRoles();
    return apiSuccess(roles.find((r) => r.role_id === id));
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/v1/roles/[id] — удаление пользовательской роли без сотрудников
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('employees.roles');
    const { id } = await params;
    const admin = createAdminClient();

    // Проверки до удаления прав: системная роль и роль с сотрудниками не удаляются (триггер БД — страховка)
    const roles = await listRoles();
    const target = roles.find((r) => r.role_id === id);
    if (!target) return apiError('Роль не найдена', 'NOT_FOUND', 404);
    if (target.is_system) return apiError(`Системную роль «${target.name}» удалить нельзя`, 'SYSTEM_ROLE', 409);
    if (target.users_count > 0) {
      return apiError(`Роль «${target.name}» назначена сотрудникам: сначала переназначьте их`, 'ROLE_IN_USE', 409);
    }

    await replaceRolePermissions(id, []);
    const { error } = await admin.from('roles').delete().eq('role_id', id);
    if (error) {
      if (error.hint === 'system_role' || error.message.includes('Системную роль')) {
        return apiError(error.message, 'SYSTEM_ROLE', 409);
      }
      if (error.hint === 'role_in_use' || error.message.includes('назначена сотрудникам')) {
        return apiError(error.message, 'ROLE_IN_USE', 409);
      }
      throw error;
    }
    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
