// Проверка матрицы статусов лидов по ролям (lib/leads/status-rules.ts).
// Запуск: node --experimental-strip-types scripts/verify-lead-status-rules.mjs
import assert from 'node:assert/strict';
import {
  LEAD_STATUSES,
  allowedLeadTransitions,
  canChangeLeadStatus,
  canEditLeadFields,
  implicitStatusForAssignment,
  isCancelStatus,
  isCancelReasonDbError,
} from '../lib/leads/status-rules.ts';

const ME = 'user-me';
const OTHER = 'user-other';
const lead = (status, extra = {}) => ({ status, created_by: ME, assigned_to: ME, ...extra });

// --- Администратор: любой переход, кроме текущего статуса -------------------------------
for (const status of LEAD_STATUSES) {
  const targets = allowedLeadTransitions('admin', lead(status, { created_by: OTHER, assigned_to: OTHER }), ME);
  assert.deepEqual(targets, LEAD_STATUSES.filter((s) => s !== status), `admin из ${status}`);
  for (const t of targets) assert.equal(canChangeLeadStatus('admin', lead(status), ME, t).ok, true);
}
assert.equal(canChangeLeadStatus('admin', lead('Отмена'), ME, 'Открыт').ok, true, 'откат из Отмены — админ');
assert.equal(canChangeLeadStatus('admin', lead('Открыт'), ME, 'Открыт').ok, false, 'тот же статус');
assert.equal(canChangeLeadStatus('admin', lead('Открыт'), ME, 'Чужой').ok, false, 'неизвестный статус');

// --- Руководитель: только просмотр -----------------------------------------------------
for (const status of LEAD_STATUSES) {
  assert.deepEqual(allowedLeadTransitions('supervisor', lead(status), ME), []);
  for (const t of LEAD_STATUSES) {
    if (t === status) continue;
    const res = canChangeLeadStatus('supervisor', lead(status), ME, t);
    assert.equal(res.ok, false);
    assert.match(res.reason, /просматривать/);
  }
}
assert.equal(canEditLeadFields('supervisor', lead('Открыт'), ME), false);

// --- SMM: свои лиды, Открыт ↔ Обработан, из обоих — в Отмену ----------------------------
assert.deepEqual(allowedLeadTransitions('smm', lead('Открыт'), ME), ['Обработан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions('smm', lead('Обработан'), ME), ['Открыт', 'Отмена']);
assert.deepEqual(allowedLeadTransitions('smm', lead('Назначен'), ME), []);
assert.deepEqual(allowedLeadTransitions('smm', lead('Подписан'), ME), []);
assert.deepEqual(allowedLeadTransitions('smm', lead('Отмена'), ME), []);
assert.deepEqual(allowedLeadTransitions('smm', lead('Открыт', { created_by: OTHER }), ME), [], 'чужой лид');
assert.equal(canChangeLeadStatus('smm', lead('Открыт'), ME, 'Обработан').ok, true);
assert.equal(canChangeLeadStatus('smm', lead('Открыт'), ME, 'Отмена').ok, true);
assert.equal(canChangeLeadStatus('smm', lead('Открыт'), ME, 'Назначен').ok, false, 'smm → Назначен');
assert.equal(canChangeLeadStatus('smm', lead('Открыт'), ME, 'Подписан').ok, false, 'smm → Подписан');
assert.match(canChangeLeadStatus('smm', lead('Отмена'), ME, 'Открыт').reason, /администратор/, 'откат из Отмены');
assert.match(canChangeLeadStatus('smm', lead('Открыт', { created_by: OTHER }), ME, 'Обработан').reason, /своих/);
assert.equal(canEditLeadFields('smm', lead('Открыт'), ME), true);
assert.equal(canEditLeadFields('smm', lead('Обработан'), ME), true);
assert.equal(canEditLeadFields('smm', lead('Назначен'), ME), false);
assert.equal(canEditLeadFields('smm', lead('Открыт', { created_by: OTHER }), ME), false);

// --- Консультант: свои лиды, только Назначен → Подписан | Отмена ------------------------
assert.deepEqual(allowedLeadTransitions('consultant', lead('Назначен'), ME), ['Подписан', 'Отмена']);
assert.deepEqual(allowedLeadTransitions('consultant', lead('Подписан'), ME), []);
assert.deepEqual(allowedLeadTransitions('consultant', lead('Открыт'), ME), []);
assert.deepEqual(allowedLeadTransitions('consultant', lead('Отмена'), ME), []);
assert.deepEqual(allowedLeadTransitions('consultant', lead('Назначен', { assigned_to: OTHER }), ME), [], 'чужой лид');
assert.equal(canChangeLeadStatus('consultant', lead('Назначен'), ME, 'Подписан').ok, true);
assert.equal(canChangeLeadStatus('consultant', lead('Назначен'), ME, 'Отмена').ok, true);
assert.equal(canChangeLeadStatus('consultant', lead('Подписан'), ME, 'Отмена').ok, false, 'Подписан → Отмена запрет');
assert.equal(canChangeLeadStatus('consultant', lead('Назначен'), ME, 'Открыт').ok, false);
assert.match(canChangeLeadStatus('consultant', lead('Отмена'), ME, 'Назначен').reason, /администратор/);
assert.match(canChangeLeadStatus('consultant', lead('Назначен', { assigned_to: OTHER }), ME, 'Подписан').reason, /своих/);
assert.equal(canEditLeadFields('consultant', lead('Назначен'), ME), true);
assert.equal(canEditLeadFields('consultant', lead('Подписан'), ME), true);
assert.equal(canEditLeadFields('consultant', lead('Открыт'), ME), false);

// --- Косвенный статус при назначении ответственного --------------------------------------
assert.equal(implicitStatusForAssignment('Открыт', ME), 'Назначен');
assert.equal(implicitStatusForAssignment('Обработан', ME), 'Назначен');
assert.equal(implicitStatusForAssignment('Назначен', ME), undefined, 'переназначение не меняет статус');
assert.equal(implicitStatusForAssignment('Назначен', null), 'Обработан', 'снятие ответственного');
assert.equal(implicitStatusForAssignment('Подписан', null), undefined);
assert.equal(implicitStatusForAssignment('Отмена', ME), undefined);

// --- Отмена и ошибка триггера БД ---------------------------------------------------------
assert.equal(isCancelStatus('Отмена'), true);
assert.equal(isCancelStatus('Открыт'), false);
assert.equal(isCancelReasonDbError({ hint: 'cancel_reason_required' }), true);
assert.equal(isCancelReasonDbError({ message: 'P0001: cancel_reason_required' }), true);
assert.equal(isCancelReasonDbError({ message: 'other' }), false);
assert.equal(isCancelReasonDbError(null), false);

console.log('verify-lead-status-rules: OK');
