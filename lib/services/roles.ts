import { createAdminClient } from '@/lib/supabase/admin';
import { ALL_PERMISSION_KEYS, isKnownPermission } from '@/lib/auth/permissions-catalog';
import type { UserRole } from '@/types/database.types';

export interface RoleRecord {
  role_id: string;
  code: string;
  name: string;
  description: string | null;
  base_role: UserRole;
  is_system: boolean;
  is_admin: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Права роли; для роли с полным доступом — все ключи каталога */
  permissions: string[];
  users_count: number;
}

export const BASE_ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Администратор', hint: 'Полный доступ к данным на уровне базы' },
  { value: 'supervisor', label: 'Учредитель', hint: 'Просмотр всех данных на уровне базы, без записи' },
  { value: 'consultant', label: 'Консультант', hint: 'Свои лиды, продавцы, подключения и операции' },
  { value: 'smm', label: 'СММ', hint: 'Свои лиды и операции по ЗП' },
];

/** Список ролей с правами и числом сотрудников */
export async function listRoles(): Promise<RoleRecord[]> {
  const admin = createAdminClient();
  const [{ data: roles, error }, { data: perms }, { data: users }] = await Promise.all([
    admin.from('roles').select('*').order('sort_order').order('name'),
    admin.from('role_permissions').select('role_id, permission'),
    admin.from('users').select('role_id'),
  ]);
  if (error) throw error;

  const permsByRole = new Map<string, string[]>();
  for (const p of perms || []) {
    const list = permsByRole.get(p.role_id) || [];
    list.push(p.permission);
    permsByRole.set(p.role_id, list);
  }
  const countByRole = new Map<string, number>();
  for (const u of users || []) {
    if (u.role_id) countByRole.set(u.role_id, (countByRole.get(u.role_id) || 0) + 1);
  }

  return (roles || []).map((r) => ({
    ...r,
    base_role: r.base_role as UserRole,
    permissions: r.is_admin ? [...ALL_PERMISSION_KEYS] : (permsByRole.get(r.role_id) || []).sort(),
    users_count: countByRole.get(r.role_id) || 0,
  }));
}

/** Нормализация списка прав: только известные ключи, без дублей */
export function normalizePermissions(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const set = new Set<string>();
  for (const k of keys) {
    if (typeof k === 'string' && isKnownPermission(k)) set.add(k);
  }
  return Array.from(set).sort();
}

/** Код роли из названия: латиница/цифры/подчеркивание, уникальность обеспечивает суффикс */
export function slugifyRoleCode(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const base = name
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  const safe = base && /^[a-z]/.test(base) ? base : `role_${base}`;
  return safe.replace(/_+$/g, '') || 'role';
}

/** Замена набора прав роли (роль с полным доступом права не хранит) */
export async function replaceRolePermissions(roleId: string, permissions: string[]): Promise<void> {
  const admin = createAdminClient();
  const { error: delErr } = await admin.from('role_permissions').delete().eq('role_id', roleId);
  if (delErr) throw delErr;
  if (permissions.length > 0) {
    const { error: insErr } = await admin
      .from('role_permissions')
      .insert(permissions.map((permission) => ({ role_id: roleId, permission })));
    if (insErr) throw insErr;
  }
}
