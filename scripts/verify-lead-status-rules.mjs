// Проверка правил статусов лидов по правам роли (lib/leads/status-rules.ts) и каталога прав.
// Запуск: node --experimental-strip-types scripts/verify-lead-status-rules.mjs
import assert from 'node:assert/strict';
import {
  LEAD_STATUSES,
  allowedLeadTransitions,
  canChangeLeadStatus,
  canEditLeadFields,
  canEditLeadComment,
  implicitStatusForAssignment,
  isCancelStatus,
  isCancelReasonDbError,
} from '../lib/leads/status-rules.ts';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
  isLeadStatusRollback,
} from '../lib/auth/permissions-catalog.ts';
import { hasPermission, legacyPermissionsForRole } from '../lib/auth/permissions.ts';
import { allowedTaskTransitions, canAssignTask, canDeleteTask, canEditTaskFields, canManageTasks } from '../lib/tasks/rules.ts';

const ME = 'user-me';
const OTHER = 'user-other';
const lead = (status, extra = {}) => ({ status, created_by: ME, assigned_to: ME, ...extra });
const actor = (code) => ({ userId: ME, permissions: code === 'admin' ? ['*'] : DEFAULT_ROLE_PERMISSIONS[code] });

// --- Каталог прав ----------------------------------------------------------------------
assert.equal(new Set(ALL_PERMISSION_KEYS).size, ALL_PERMISSION_KEYS.length, 'ключи прав уникальны');
for (const m of PERMISSION_MODULES) {
  assert.ok(m.permissions.length > 0, `модуль ${m.id} без прав`);
  for (const p of m.permissions) assert.ok(p.key.startsWith(`${m.id}.`) || m.id === 'system' || m.id === 'plans', `ключ ${p.key} вне модуля ${m.id}`);
}
for (const [code, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
  for (const k of perms) assert.ok(ALL_PERMISSION_KEYS.includes(k), `${code}: неизвестное право ${k}`);
}
assert.equal(hasPermission(['*'], 'anything.new'), true, 'полный доступ покрывает новые ключи');
assert.equal(hasPermission(['leads.menu'], 'leads.delete'), false);
assert.deepEqual(legacyPermissionsForRole('admin'), ['*']);
assert.deepEqual(legacyPermissionsForRole('supervisor'), DEFAULT_ROLE_PERMISSIONS.founder);

// --- Откат статуса ----------------------------------------------------------------------
assert.equal(isLeadStatusRollback('Открыт', 'Обработан'), false);
assert.equal(isLeadStatusRollback('Обработан', 'Открыт'), true);
assert.equal(isLeadStatusRollback('Подписан', 'Назначен'), true);
assert.equal(isLeadStatusRollback('Отмена', 'Открыт'), true);
assert.equal(isLeadStatusRollback('Назначен', 'Отмена'), false);

// --- Администратор: любой переход, кроме текущего статуса -------------------------------
for (const status of LEAD_STATUSES) {
  const targets = allowedLeadTransitions(actor('admin'), lead(status, { created_by: OTHER, assigned_to: OTHER }));
  assert.deepEqual(targets, LEAD_STATUSES.filter((s) => s !== status), `admin из ${status}`);
  for (const t of targets) assert.equal(canChangeLeadStatus(actor('admin'), lead(status), t).ok, true);
}
assert.equal(canChangeLeadStatus(actor('admin'), lead('Отмена'), 'Открыт').ok, true, 'откат из Отмены — админ');
assert.equal(canChangeLeadStatus(actor('admin'), lead('Открыт'), 'Открыт').ok, false, 'тот же статус');
assert.equal(canChangeLeadStatus(actor('admin'), lead('Открыт'), 'Чужой').ok, false, 'неизвестный статус');

// --- Учредитель: видит всё, статусы не меняет --------------------------------------------
for (const status of LEAD_STATUSES) {
  assert.deepEqual(allowedLeadTransitions(actor('founder'), lead(status, { created_by: OTHER, assigned_to: OTHER })), []);
}
assert.equal(canEditLeadFields(actor('founder'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER })), false);
assert.match(canChangeLeadStatus(actor('founder'), lead('Открыт'), 'Обработан').reason, /прав/);

// --- СММ: свои лиды, Открыт ↔ Обработан, в Отмену; откат разрешен -----------------------
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Открыт')), ['Обработан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Обработан')), ['Открыт', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Назначен')), ['Открыт', 'Обработан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Отмена')), ['Открыт', 'Обработан']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER })), [], 'чужой лид');
assert.equal(canChangeLeadStatus(actor('smm'), lead('Открыт'), 'Назначен').ok, false, 'smm → Назначен');
assert.equal(canChangeLeadStatus(actor('smm'), lead('Открыт'), 'Подписан').ok, false, 'smm → Подписан');
assert.match(canChangeLeadStatus(actor('smm'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER }), 'Обработан').reason, /своих/);
assert.equal(canEditLeadFields(actor('smm'), lead('Открыт')), true);
assert.equal(canEditLeadFields(actor('smm'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER })), false);

// --- Консультант: свои лиды, Назначен → Подписан | Отмена, без отката -------------------
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Назначен')), ['Подписан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Подписан')), ['Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Отмена')), [], 'возврат из Отмены без права отката');
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Назначен', { assigned_to: OTHER, created_by: OTHER })), [], 'чужой лид');
assert.match(canChangeLeadStatus(actor('consultant'), lead('Отмена'), 'Подписан').reason, /Отмена/);
assert.equal(canEditLeadFields(actor('consultant'), lead('Назначен')), false, 'без полного редактирования');
assert.equal(canEditLeadComment(actor('consultant'), lead('Назначен')), true, 'комментарий разрешен');
assert.equal(canEditLeadComment(actor('consultant'), lead('Назначен', { assigned_to: OTHER, created_by: OTHER })), false);

// --- Пользовательская роль: «старший консультант» с правом отката -----------------------
const senior = { userId: ME, permissions: [...DEFAULT_ROLE_PERMISSIONS.consultant, 'leads.rollback', 'leads.status.Назначен', 'leads.view_all'] };
assert.deepEqual(allowedLeadTransitions(senior, lead('Подписан', { assigned_to: OTHER, created_by: OTHER })), ['Назначен', 'Отмена']);
assert.equal(canChangeLeadStatus(senior, lead('Отмена'), 'Назначен').ok, true, 'возврат из Отмены с правом отката');

// --- Косвенный статус при назначении -----------------------------------------------------
assert.equal(implicitStatusForAssignment('Открыт', OTHER), 'Назначен');
assert.equal(implicitStatusForAssignment('Обработан', OTHER), 'Назначен');
assert.equal(implicitStatusForAssignment('Назначен', null), 'Обработан');
assert.equal(implicitStatusForAssignment('Подписан', null), undefined);
assert.equal(isCancelStatus('Отмена'), true);
assert.equal(isCancelReasonDbError({ hint: 'cancel_reason_required' }), true);

// --- Задачи -------------------------------------------------------------------------------
const task = (status, extra = {}) => ({ status, assigned_to: ME, created_by: OTHER, ...extra });
assert.equal(canManageTasks(actor('admin')), true);
assert.equal(canManageTasks(actor('founder')), true);
assert.equal(canManageTasks(actor('consultant')), false);
assert.equal(canAssignTask(actor('consultant')), false);
assert.deepEqual(allowedTaskTransitions(actor('consultant'), task('Назначен')), ['Выполнен', 'Отложен', 'Отмена']);
assert.deepEqual(allowedTaskTransitions(actor('consultant'), task('Выполнен')), [], 'закрытую не возвращает');
assert.deepEqual(allowedTaskTransitions(actor('consultant'), task('Назначен', { assigned_to: OTHER })), [], 'чужая задача');
assert.ok(allowedTaskTransitions(actor('founder'), task('Выполнен', { assigned_to: OTHER })).includes('Открыт'));
assert.equal(canEditTaskFields(actor('consultant'), task('Открыт')), false, 'не автор');
assert.equal(canEditTaskFields(actor('consultant'), task('Открыт', { created_by: ME })), true, 'автор');
assert.equal(canDeleteTask(actor('consultant'), task('Открыт', { created_by: ME })), true);
assert.equal(canDeleteTask(actor('consultant'), task('Открыт')), false);
assert.equal(canDeleteTask(actor('admin'), task('Открыт')), true);

console.log('verify-lead-status-rules: все проверки пройдены');
