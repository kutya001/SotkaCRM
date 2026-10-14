import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { listRoles, normalizePermissions, replaceRolePermissions, slugifyRoleCode } from '@/lib/services/roles';
import { PERMISSION_MODULES } from '@/lib/auth/permissions-catalog';

const RoleCreateSchema = z.object({
  name: z.string().trim().min(2, 'Название роли — минимум 2 символа').max(60, 'Название роли — не длиннее 60 символов'),
  description: z.string().trim().max(300, 'Описание — не длиннее 300 символов').nullable().optional(),
  base_role: z.enum(['admin', 'supervisor', 'consultant', 'smm']).optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * GET /api/v1/roles — роли с правами и числом сотрудников (для вкладки «Роли — Доступы» и форм сотрудника)
 */
export async function GET(_req: NextRequest) {
  try {
    await requireAnyPermission(['employees.menu', 'employees.roles', 'employees.create', 'employees.edit']);
    const roles = await listRoles();
    return apiSuccess({ items: roles, catalog: PERMISSION_MODULES });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/v1/roles — новая роль
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermission('employees.roles');
    const body = RoleCreateSchema.parse(await req.json());
    const admin = createAdminClient();

    // Уникальный код из названия
    const baseCode = slugifyRoleCode(body.name);
    const { data: existing } = await admin.from('roles').select('code').like('code', `${baseCode}%`);
    const taken = new Set((existing || []).map((r) => r.code));
    let code = baseCode;
    for (let i = 2; taken.has(code); i++) code = `${baseCode}_${i}`;

    const { data: role, error } = await admin
      .from('roles')
      .insert({
        code,
        name: body.name,
        description: body.description ?? null,
        base_role: body.base_role ?? 'consultant',
        is_system: false,
        is_admin: false,
        sort_order: 100,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('roles_code')) return apiError('Роль с таким кодом уже есть', 'DUPLICATE', 409);
      throw error;
    }

    await replaceRolePermissions(role.role_id, normalizePermissions(body.permissions));
    const roles = await listRoles();
    return apiSuccess(roles.find((r) => r.role_id === role.role_id) ?? role, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
