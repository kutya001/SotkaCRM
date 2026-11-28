// Проверка правил статусов лидов по правам роли (lib/leads/status-rules.ts) и каталога прав.
// Запуск: node --experimental-strip-types scripts/verify-lead-status-rules.mjs
import assert from 'node:assert/strict';
import {
  LEAD_STATUSES,
  ACTIVE_LEAD_STATUSES,
  allowedLeadTransitions,
  buildStatusChange,
  canChangeLeadStatus,
  canRescheduleLead,
  isStatusDateDbError,
  parseScheduleDate,
  statusDateField,
  canEditLeadFields,
  canEditLeadComment,
  implicitStatusForAssignment,
  isCancelStatus,
  isCancelReasonDbError,
  reassignBlockReason,
} from '../lib/leads/status-rules.ts';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
  isLeadStatusRollback,
} from '../lib/auth/permissions-catalog.ts';
import { hasPermission, legacyPermissionsForRole } from '../lib/auth/permissions.ts';
import { CANCEL_REASONS, buildCancelReason, cancelReasonLabel } from '../lib/leads/cancel-reasons.ts';
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
// Новые статусы (050/051): «Встреча» — тот же этап, что «Назначен»; ожидание — боковые статусы
assert.equal(isLeadStatusRollback('Назначен', 'Встреча'), false);
assert.equal(isLeadStatusRollback('Встреча', 'Назначен'), false, 'встреча сорвалась — без отката');
assert.equal(isLeadStatusRollback('Встреча', 'Обработан'), true);
assert.equal(isLeadStatusRollback('Обработан', 'Нет ответа'), false);
assert.equal(isLeadStatusRollback('Назначен', 'Перезвонить'), false);
assert.equal(isLeadStatusRollback('Перезвонить', 'Назначен'), false);
assert.equal(isLeadStatusRollback('Нет ответа', 'Открыт'), false);
assert.equal(isLeadStatusRollback('Подписан', 'Перезвонить'), true, 'из «Подписан» в ожидание — откат');
assert.equal(isLeadStatusRollback('Отмена', 'Перезвонить'), true);
assert.deepEqual(LEAD_STATUSES, ['Открыт', 'Нет ответа', 'Обработан', 'Назначен', 'Встреча', 'Перезвонить', 'Подписан', 'Отмена']);
assert.deepEqual(ACTIVE_LEAD_STATUSES, ['Открыт', 'Нет ответа', 'Обработан', 'Назначен', 'Встреча', 'Перезвонить']);

// --- Администратор: любой переход, кроме текущего статуса и «Подписан» (только привязкой, 046) ---
for (const status of LEAD_STATUSES) {
  const targets = allowedLeadTransitions(actor('admin'), lead(status, { created_by: OTHER, assigned_to: OTHER }));
  assert.deepEqual(targets, LEAD_STATUSES.filter((s) => s !== status && s !== 'Подписан'), `admin из ${status}`);
  for (const t of targets) assert.equal(canChangeLeadStatus(actor('admin'), lead(status), t).ok, true);
}
assert.equal(canChangeLeadStatus(actor('admin'), lead('Отмена'), 'Открыт').ok, true, 'откат из Отмены — админ');
assert.equal(canChangeLeadStatus(actor('admin'), lead('Открыт'), 'Открыт').ok, false, 'тот же статус');
assert.equal(canChangeLeadStatus(actor('admin'), lead('Открыт'), 'Чужой').ok, false, 'неизвестный статус');

// --- «Подписан» только привязкой; привязанный лид меняет статус только отвязкой (046) -------
assert.ok(!ALL_PERMISSION_KEYS.includes('leads.status.Подписан'), 'права на ручной «Подписан» нет в каталоге');
assert.match(canChangeLeadStatus(actor('admin'), lead('Назначен'), 'Подписан').reason, /привязк/);
const linked = lead('Подписан', { seller_phone: '996700000001' });
assert.deepEqual(allowedLeadTransitions(actor('admin'), linked), [], 'привязанный лид');
assert.match(canChangeLeadStatus(actor('admin'), linked, 'Отмена').reason, /отвяжите/);
// Ответственный привязанного лида — консультант подключения: сменить нельзя (канбан, таблица, API)
assert.match(reassignBlockReason(linked), /консультант подключения/);
assert.equal(reassignBlockReason(lead('Назначен')), null);

// --- Учредитель: видит всё, статусы не меняет --------------------------------------------
for (const status of LEAD_STATUSES) {
  assert.deepEqual(allowedLeadTransitions(actor('founder'), lead(status, { created_by: OTHER, assigned_to: OTHER })), []);
}
assert.equal(canEditLeadFields(actor('founder'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER })), false);
assert.match(canChangeLeadStatus(actor('founder'), lead('Открыт'), 'Обработан').reason, /прав/);

// --- СММ: свои лиды, Открыт ↔ Нет ответа ↔ Обработан, в Отмену; откат разрешен ------------
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Открыт')), ['Нет ответа', 'Обработан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Нет ответа')), ['Открыт', 'Обработан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Обработан')), ['Открыт', 'Нет ответа', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Назначен')), ['Открыт', 'Нет ответа', 'Обработан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Отмена')), ['Открыт', 'Нет ответа', 'Обработан']);
assert.equal(canChangeLeadStatus(actor('smm'), lead('Обработан'), 'Встреча').ok, false, 'smm → Встреча');
assert.deepEqual(allowedLeadTransitions(actor('smm'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER })), [], 'чужой лид');
assert.equal(canChangeLeadStatus(actor('smm'), lead('Открыт'), 'Назначен').ok, false, 'smm → Назначен');
assert.equal(canChangeLeadStatus(actor('smm'), lead('Открыт'), 'Подписан').ok, false, 'smm → Подписан');
assert.match(canChangeLeadStatus(actor('smm'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER }), 'Обработан').reason, /своих/);
assert.equal(canEditLeadFields(actor('smm'), lead('Открыт')), true);
assert.equal(canEditLeadFields(actor('smm'), lead('Открыт', { created_by: OTHER, assigned_to: OTHER })), false);

// --- Консультант: свои лиды, Назначен ↔ Встреча / Перезвонить / Нет ответа, в Отмену, без отката ---
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Назначен')), ['Нет ответа', 'Встреча', 'Перезвонить', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Встреча')), ['Нет ответа', 'Назначен', 'Перезвонить', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Перезвонить')), ['Нет ответа', 'Назначен', 'Встреча', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Нет ответа')), ['Назначен', 'Встреча', 'Перезвонить', 'Отмена']);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Подписан')), ['Отмена']);
assert.match(canChangeLeadStatus(actor('consultant'), lead('Встреча'), 'Обработан').reason, /прав/);
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Отмена')), [], 'возврат из Отмены без права отката');
assert.deepEqual(allowedLeadTransitions(actor('consultant'), lead('Назначен', { assigned_to: OTHER, created_by: OTHER })), [], 'чужой лид');
const consultantWithAssign = { userId: ME, permissions: [...DEFAULT_ROLE_PERMISSIONS.consultant, 'leads.status.Назначен'] };
assert.match(canChangeLeadStatus(consultantWithAssign, lead('Отмена'), 'Назначен').reason, /Отмена/, 'без права отката');
assert.equal(canEditLeadFields(actor('consultant'), lead('Назначен')), false, 'без полного редактирования');
assert.equal(canEditLeadComment(actor('consultant'), lead('Назначен')), true, 'комментарий разрешен');
assert.equal(canEditLeadComment(actor('consultant'), lead('Назначен', { assigned_to: OTHER, created_by: OTHER })), false);

// --- Пользовательская роль: «старший консультант» с правом отката -----------------------
const senior = { userId: ME, permissions: [...DEFAULT_ROLE_PERMISSIONS.consultant, 'leads.rollback', 'leads.status.Назначен', 'leads.view_all'] };
assert.deepEqual(allowedLeadTransitions(senior, lead('Подписан', { assigned_to: OTHER, created_by: OTHER })), [
  'Нет ответа',
  'Назначен',
  'Встреча',
  'Перезвонить',
  'Отмена',
]);
assert.equal(canChangeLeadStatus(senior, lead('Отмена'), 'Назначен').ok, true, 'возврат из Отмены с правом отката');

// --- Косвенный статус при назначении -----------------------------------------------------
assert.equal(implicitStatusForAssignment('Открыт', OTHER), 'Назначен');
assert.equal(implicitStatusForAssignment('Обработан', OTHER), 'Назначен');
assert.equal(implicitStatusForAssignment('Назначен', null), 'Обработан');
assert.equal(implicitStatusForAssignment('Подписан', null), undefined);
assert.equal(implicitStatusForAssignment('Нет ответа', OTHER), 'Назначен', 'назначение из «Нет ответа»');
assert.equal(implicitStatusForAssignment('Встреча', null), undefined, 'снятие ответственного не сбрасывает встречу');
assert.equal(implicitStatusForAssignment('Перезвонить', OTHER), undefined);

// --- Даты статусов (051) -----------------------------------------------------------------
assert.equal(statusDateField('Встреча'), 'meeting_at');
assert.equal(statusDateField('Перезвонить'), 'next_contact_at');
assert.equal(statusDateField('Назначен'), null);
assert.equal(parseScheduleDate('2026-11-29T10:00:00.000Z'), '2026-11-29T10:00:00.000Z');
assert.equal(parseScheduleDate('2026-11-29T16:00'), new Date('2026-11-29T16:00').toISOString());
assert.equal(parseScheduleDate('мусор'), null);
assert.equal(parseScheduleDate('1999-01-01T00:00:00Z'), null);
assert.equal(parseScheduleDate(null), null);
assert.deepEqual(buildStatusChange('Встреча', { meeting_at: '2026-11-29T10:00:00Z' }), {
  ok: true,
  updates: { status: 'Встреча', meeting_at: '2026-11-29T10:00:00.000Z' },
});
assert.equal(buildStatusChange('Встреча', {}).code, 'MEETING_AT_REQUIRED');
assert.equal(buildStatusChange('Перезвонить', { next_contact_at: '' }).code, 'NEXT_CONTACT_AT_REQUIRED');
assert.deepEqual(buildStatusChange('Обработан', {}), { ok: true, updates: { status: 'Обработан' } });
assert.equal(isStatusDateDbError({ hint: 'meeting_at_required' }), true);
assert.equal(isStatusDateDbError({ message: 'other' }), false);

// --- Причины отмены списком (051) ---------------------------------------------------------
assert.equal(new Set(CANCEL_REASONS.map((r) => r.code)).size, CANCEL_REASONS.length);
assert.deepEqual(buildCancelReason('too_expensive', ''), { ok: true, code: 'too_expensive', text: 'Дорого' });
assert.deepEqual(buildCancelReason('too_expensive', '  подумает  до весны '), { ok: true, code: 'too_expensive', text: 'Дорого: подумает до весны' });
assert.equal(buildCancelReason('other', 'ок').ok, false, '«Другое» без описания');
assert.deepEqual(buildCancelReason('other', 'Закрыл магазин'), { ok: true, code: 'other', text: 'Другое: Закрыл магазин' });
assert.deepEqual(buildCancelReason(null, 'Старый формат причины'), { ok: true, code: 'other', text: 'Старый формат причины' });
assert.equal(buildCancelReason(null, '').ok, false);
assert.equal(buildCancelReason('bogus', 'текст').ok, false);
assert.equal(cancelReasonLabel(null), 'Не указана');
assert.deepEqual(buildStatusChange('Отмена', { cancel_reason_code: 'not_target' }), {
  ok: true,
  updates: { status: 'Отмена', cancel_reason: 'Не целевой', cancel_reason_code: 'not_target' },
});
assert.equal(buildStatusChange('Отмена', {}).code, 'CANCEL_REASON_REQUIRED');

// --- Перенос даты без смены статуса -----------------------------------------------------
assert.equal(canRescheduleLead(actor('consultant'), lead('Встреча')).ok, true);
assert.equal(canRescheduleLead(actor('consultant'), lead('Назначен')).ok, false);
assert.equal(canRescheduleLead(actor('consultant'), lead('Встреча', { assigned_to: OTHER, created_by: OTHER })).ok, false);
assert.equal(canRescheduleLead(actor('smm'), lead('Перезвонить')).ok, false, 'без права на статус');
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
