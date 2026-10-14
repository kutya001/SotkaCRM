'use client';

import * as React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Save,
  Users,
  Lock,
  ChevronDown,
  CheckSquare,
  Square,
  RotateCcw,
} from 'lucide-react';
import { api, type RoleItem } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useUser } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PERMISSION_MODULES, ALL_PERMISSION_KEYS } from '@/lib/auth/permissions-catalog';
import { cn } from '@/lib/utils/cn';

const BASE_ROLE_OPTIONS: { value: RoleItem['base_role']; label: string; hint: string }[] = [
  { value: 'consultant', label: 'Консультант', hint: 'в базе видны свои лиды, продавцы, подключения и операции' },
  { value: 'smm', label: 'СММ', hint: 'в базе видны свои лиды и операции по ЗП' },
  { value: 'supervisor', label: 'Учредитель', hint: 'в базе видны все данные, запись — только через права' },
  { value: 'admin', label: 'Администратор', hint: 'полный доступ к данным на уровне базы' },
];

const CREATE_FORM_ID = 'role-create-form';

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((k) => s.has(k));
}

/**
 * Вкладка «Роли — Доступы» модуля «Сотрудники»: список ролей, создание и редактирование прав,
 * сгруппированных по модулям. Роль с полным доступом (Администратор) всегда имеет все права.
 */
export function RolesAccessPanel() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const user = useUser();
  const canManage = user.can('employees.roles');

  const [roles, setRoles] = React.useState<RoleItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Черновик редактируемой роли
  const [draftName, setDraftName] = React.useState('');
  const [draftDescription, setDraftDescription] = React.useState('');
  const [draftBase, setDraftBase] = React.useState<RoleItem['base_role']>('consultant');
  const [draftPerms, setDraftPerms] = React.useState<string[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [collapsedModules, setCollapsedModules] = React.useState<Record<string, boolean>>({});

  // Создание роли
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [newBase, setNewBase] = React.useState<RoleItem['base_role']>('consultant');
  const [newCopyFrom, setNewCopyFrom] = React.useState<string>('');
  const [isCreating, setIsCreating] = React.useState(false);

  const selected = React.useMemo(() => roles.find((r) => r.role_id === selectedId) || null, [roles, selectedId]);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.roles.getAll({ bypassCache: true });
      setRoles(res.items || []);
      setSelectedId((prev) => prev ?? res.items?.[0]?.role_id ?? null);
    } catch (err: any) {
      showToast(err.message || 'Не удалось загрузить роли', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Сброс черновика при смене выбранной роли
  React.useEffect(() => {
    if (!selected) return;
    setDraftName(selected.name);
    setDraftDescription(selected.description || '');
    setDraftBase(selected.base_role);
    setDraftPerms(selected.permissions);
  }, [selected]);

  const isDirty =
    Boolean(selected) &&
    (draftName.trim() !== selected!.name ||
      (draftDescription.trim() || '') !== (selected!.description || '') ||
      draftBase !== selected!.base_role ||
      (!selected!.is_admin && !sameSet(draftPerms, selected!.permissions)));

  const togglePermission = (key: string) => {
    if (!canManage || selected?.is_admin) return;
    setDraftPerms((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const toggleModule = (moduleId: string, allOn: boolean) => {
    if (!canManage || selected?.is_admin) return;
    const keys = PERMISSION_MODULES.find((m) => m.id === moduleId)?.permissions.map((p) => p.key) || [];
    setDraftPerms((prev) => {
      const without = prev.filter((k) => !keys.includes(k));
      return allOn ? without : [...without, ...keys];
    });
  };

  const handleSave = async () => {
    if (!selected || !isDirty) return;
    setIsSaving(true);
    try {
      const updated = await api.roles.update(selected.role_id, {
        name: draftName.trim(),
        description: draftDescription.trim() || null,
        base_role: draftBase,
        permissions: selected.is_admin ? undefined : draftPerms,
      });
      setRoles((prev) => prev.map((r) => (r.role_id === updated.role_id ? updated : r)));
      showToast(`Роль «${updated.name}» сохранена`, 'success');
      // Свои права могли измениться — обновляем контекст
      if (user.profile?.role_id === updated.role_id) await user.refreshUser();
    } catch (err: any) {
      showToast(err.message || 'Не удалось сохранить роль', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Удалить роль?',
      subtitle: selected.name,
      description: 'Удаляются только пользовательские роли без назначенных сотрудников.',
      tone: 'danger',
      icon: Trash2,
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    try {
      await api.roles.delete(selected.role_id);
      setRoles((prev) => prev.filter((r) => r.role_id !== selected.role_id));
      setSelectedId(null);
      showToast('Роль удалена', 'success');
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить роль', 'error');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const source = roles.find((r) => r.role_id === newCopyFrom);
      const created = await api.roles.create({
        name: newName.trim(),
        description: newDescription.trim() || null,
        base_role: newBase,
        permissions: source ? source.permissions : [],
      });
      setRoles((prev) => [...prev, created]);
      setSelectedId(created.role_id);
      setIsCreateOpen(false);
      setNewName('');
      setNewDescription('');
      setNewBase('consultant');
      setNewCopyFrom('');
      showToast(`Роль «${created.name}» создана`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Не удалось создать роль', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const draftSet = React.useMemo(() => new Set(draftPerms), [draftPerms]);
  const grantedCount = selected?.is_admin ? ALL_PERMISSION_KEYS.length : draftPerms.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
      {/* Список ролей */}
      <aside className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Роли</span>
          {canManage && (
            <Button size="sm" onClick={() => setIsCreateOpen(true)} leftIcon={<Plus className="w-3.5 h-3.5" strokeWidth={2} />}>
              Новая роль
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-xs text-zinc-400 rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40">
            Загрузка ролей...
          </div>
        ) : (
          <div className="space-y-1.5">
            {roles.map((role) => {
              const active = role.role_id === selectedId;
              const Icon = role.is_admin ? ShieldAlert : ShieldCheck;
              return (
                <button
                  key={role.role_id}
                  type="button"
                  onClick={() => setSelectedId(role.role_id)}
                  className={cn(
                    'w-full text-left p-3 rounded-2xl border transition-all island-interactive',
                    active
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent shadow-sm'
                      : 'island-glass border-white/20 dark:border-zinc-800/40 hover:border-zinc-300 dark:hover:border-zinc-700'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-4 h-4 flex-shrink-0', active ? '' : role.is_admin ? 'text-rose-500' : 'text-blue-500')} strokeWidth={1.75} />
                    <span className="text-sm font-semibold truncate flex-1">{role.name}</span>
                    {role.is_system && <Lock className={cn('w-3 h-3 flex-shrink-0', active ? 'opacity-70' : 'text-zinc-400')} strokeWidth={2} />}
                  </div>
                  <div className={cn('mt-1 flex items-center gap-2 text-[10px]', active ? 'opacity-80' : 'text-zinc-500 dark:text-zinc-400')}>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" strokeWidth={1.75} />
                      {role.users_count}
                    </span>
                    <span>·</span>
                    <span>{role.is_admin ? 'все права' : `прав: ${role.permissions.length} из ${ALL_PERMISSION_KEYS.length}`}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* Редактор роли */}
      <section className="rounded-3xl island-glass border border-white/20 dark:border-zinc-800/40 shadow-sm">
        {!selected ? (
          <div className="p-10 text-center text-xs text-zinc-400">Выберите роль слева или создайте новую</div>
        ) : (
          <div className="flex flex-col">
            <div className="p-4 sm:p-5 border-b border-zinc-200/60 dark:border-zinc-800/60 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    {selected.name}
                    {selected.is_system && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                        системная
                      </span>
                    )}
                    {selected.is_admin && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        полный доступ
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Код: <span className="font-mono">{selected.code}</span> · сотрудников: {selected.users_count} · прав: {grantedCount} из{' '}
                    {ALL_PERMISSION_KEYS.length}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    {isDirty && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDraftName(selected.name);
                          setDraftDescription(selected.description || '');
                          setDraftBase(selected.base_role);
                          setDraftPerms(selected.permissions);
                        }}
                        leftIcon={<RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />}
                      >
                        Отменить
                      </Button>
                    )}
                    {!selected.is_system && selected.users_count === 0 && (
                      <Button variant="danger" size="sm" onClick={handleDelete} leftIcon={<Trash2 className="w-3.5 h-3.5" strokeWidth={2} />}>
                        Удалить
                      </Button>
                    )}
                    <Button size="sm" onClick={handleSave} disabled={!isDirty} loading={isSaving} leftIcon={<Save className="w-3.5 h-3.5" strokeWidth={2} />}>
                      Сохранить
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Название роли" required htmlFor="role-name">
                  <Input id="role-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={!canManage} maxLength={60} />
                </FormField>
                <FormField
                  label="Базовый профиль данных"
                  htmlFor="role-base"
                  hint={BASE_ROLE_OPTIONS.find((o) => o.value === draftBase)?.hint}
                >
                  <Select
                    id="role-base"
                    value={draftBase}
                    onChange={(e) => setDraftBase(e.target.value as RoleItem['base_role'])}
                    disabled={!canManage || selected.is_admin}
                  >
                    {BASE_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Описание" htmlFor="role-description" className="md:col-span-2">
                  <Textarea
                    id="role-description"
                    rows={2}
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    disabled={!canManage}
                    maxLength={300}
                    placeholder="Для чего предназначена роль"
                  />
                </FormField>
              </div>

              {selected.is_admin && (
                <div className="p-3 rounded-2xl bg-rose-500/5 border border-rose-500/20 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
                  <span>
                    Роль с полным доступом имеет все права по умолчанию, включая добавляемые в будущем. Это защита от
                    потери доступа к настройкам; набор прав этой роли не редактируется.
                  </span>
                </div>
              )}
            </div>

            {/* Права по модулям */}
            <div className="p-4 sm:p-5 space-y-3">
              {PERMISSION_MODULES.map((module) => {
                const keys = module.permissions.map((p) => p.key);
                const onCount = selected.is_admin ? keys.length : keys.filter((k) => draftSet.has(k)).length;
                const allOn = onCount === keys.length;
                const collapsed = collapsedModules[module.id];
                return (
                  <div key={module.id} className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/50 dark:bg-zinc-900/40">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setCollapsedModules((prev) => ({ ...prev, [module.id]: !prev[module.id] }))}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        aria-expanded={!collapsed}
                      >
                        <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform', collapsed && '-rotate-90')} strokeWidth={2} />
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">{module.title}</span>
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold',
                            onCount === 0
                              ? 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500'
                              : allOn
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          )}
                        >
                          {onCount}/{keys.length}
                        </span>
                      </button>
                      {canManage && !selected.is_admin && (
                        <button
                          type="button"
                          onClick={() => toggleModule(module.id, allOn)}
                          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                        >
                          {allOn ? 'Снять все' : 'Выбрать все'}
                        </button>
                      )}
                    </div>
                    {!collapsed && (
                      <div className="px-2 pb-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                        {module.permissions.map((perm) => {
                          const checked = selected.is_admin || draftSet.has(perm.key);
                          const disabled = !canManage || selected.is_admin;
                          const Icon = checked ? CheckSquare : Square;
                          return (
                            <button
                              key={perm.key}
                              type="button"
                              disabled={disabled}
                              onClick={() => togglePermission(perm.key)}
                              aria-pressed={checked}
                              title={perm.key}
                              className={cn(
                                'flex items-start gap-2 px-2 py-1.5 rounded-xl text-left transition-colors',
                                disabled ? 'cursor-default' : 'hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 cursor-pointer',
                                checked ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
                              )}
                            >
                              <Icon
                                className={cn('w-4 h-4 flex-shrink-0 mt-0.5', checked ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-300 dark:text-zinc-600')}
                                strokeWidth={2}
                              />
                              <span className="min-w-0">
                                <span className="block text-xs font-medium leading-snug">{perm.label}</span>
                                {perm.hint && <span className="block text-[10px] text-zinc-400 leading-snug">{perm.hint}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Создание роли */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Новая роль"
        subtitle="Права настраиваются после создания"
        icon={Plus}
        tone="info"
        size="md"
        busy={isCreating}
        formId={CREATE_FORM_ID}
        onSubmit={handleCreate}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>
              Отмена
            </Button>
            <Button type="submit" form={CREATE_FORM_ID} loading={isCreating}>
              Создать
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Название роли" required htmlFor="role-create-name">
            <Input id="role-create-name" required minLength={2} maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Старший консультант" size="lg" />
          </FormField>
          <FormField label="Описание" htmlFor="role-create-description">
            <Textarea id="role-create-description" rows={2} maxLength={300} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          </FormField>
          <FormField label="Базовый профиль данных" htmlFor="role-create-base" hint={BASE_ROLE_OPTIONS.find((o) => o.value === newBase)?.hint}>
            <Select id="role-create-base" value={newBase} onChange={(e) => setNewBase(e.target.value as RoleItem['base_role'])} size="lg">
              {BASE_ROLE_OPTIONS.filter((o) => o.value !== 'admin').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Скопировать права из роли" htmlFor="role-create-copy" hint="Удобно взять за основу одну из существующих ролей">
            <Select id="role-create-copy" value={newCopyFrom} onChange={(e) => setNewCopyFrom(e.target.value)} size="lg">
              <option value="">— Без прав (настроить вручную) —</option>
              {roles
                .filter((r) => !r.is_admin)
                .map((r) => (
                  <option key={r.role_id} value={r.role_id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
