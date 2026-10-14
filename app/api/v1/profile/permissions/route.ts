import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

/**
 * Права текущего сотрудника: назначенная роль и ключи каталога.
 * Старые булевы ключи сохранены для совместимости клиентов.
 */
export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireAuth();
    const { profile, permissions, isAdmin, can } = ctx;

    return apiSuccess({
      role: profile.role,
      role_code: profile.role_code,
      role_name: profile.role_name,
      is_admin: isAdmin,
      permissions,
      can_access_docs: can('docs.menu'),
      can_sync_api: can('sellers.sync'),
      can_manage_rates: can('rates.manage'),
      can_manage_plans: can('plans.manage'),
      can_manage_employees: can('employees.menu'),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
