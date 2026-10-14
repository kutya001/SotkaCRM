/**
 * Чистые помощники проверки прав (сервер и клиент).
 * Набор прав — массив ключей каталога; «*» означает полный доступ (роль is_admin).
 */
import { DEFAULT_ROLE_PERMISSIONS, LEGACY_ROLE_TO_CODE } from './permissions-catalog.ts';
import type { UserRole } from '@/types/database.types';

export type PermissionSet = ReadonlySet<string> | readonly string[];

function toSet(perms: PermissionSet): ReadonlySet<string> {
  return perms instanceof Set ? perms : new Set(perms as readonly string[]);
}

export function hasPermission(perms: PermissionSet, key: string): boolean {
  const set = toSet(perms);
  return set.has('*') || set.has(key);
}

export function hasAnyPermission(perms: PermissionSet, keys: string[]): boolean {
  return keys.some((k) => hasPermission(perms, k));
}

export function hasAllPermissions(perms: PermissionSet, keys: string[]): boolean {
  return keys.every((k) => hasPermission(perms, k));
}

/** Видит ли сотрудник все записи модуля (иначе — только свои) */
export function canViewAll(perms: PermissionSet, module: string): boolean {
  return hasPermission(perms, `${module}.view_all`);
}

/** Запасной набор прав по устаревшему enum (пока роль не загружена или не назначена) */
export function legacyPermissionsForRole(role: UserRole | string | null | undefined): string[] {
  const code = LEGACY_ROLE_TO_CODE[(role || 'consultant') as keyof typeof LEGACY_ROLE_TO_CODE] || 'consultant';
  return code === 'admin' ? ['*'] : DEFAULT_ROLE_PERMISSIONS[code];
}
