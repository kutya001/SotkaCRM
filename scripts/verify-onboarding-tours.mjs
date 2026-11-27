// Проверка туров обучения (lib/onboarding/tours.ts): уникальные id, маршруты, права из каталога,
// каждая метка шага (target) есть в разметке как data-tour="…", нет emoji (правило интерфейса).
// Запуск: node --experimental-strip-types scripts/verify-onboarding-tours.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_TOURS_ID, TOURS, isTourAvailable, stepsFor, tourById, tourForPath } from '../lib/onboarding/tours.ts';
import { isKnownPermission } from '../lib/auth/permissions-catalog.ts';

const root = new URL('..', import.meta.url).pathname;

// Все значения data-tour в разметке (app/ и components/)
function collectSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectSources(path, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(readFileSync(path, 'utf8'));
  }
  return out;
}
const sources = [...collectSources(join(root, 'app')), ...collectSources(join(root, 'components'))].join('\n');
const markers = new Set();
for (const m of sources.matchAll(/data-tour="([^"]+)"/g)) for (const v of m[1].split(/\s+/)) markers.add(v);

assert.equal(new Set(TOURS.map((t) => t.id)).size, TOURS.length, 'id туров уникальны');
assert.ok(!TOURS.some((t) => t.id === ALL_TOURS_ID), `id «${ALL_TOURS_ID}» зарезервирован`);
assert.equal(TOURS.filter((t) => t.route === '*').length, 1, 'один общий тур оболочки');

for (const tour of TOURS) {
  assert.ok(tour.steps.length > 0, `${tour.id}: нет шагов`);
  assert.ok(tour.version >= 1, `${tour.id}: версия`);
  assert.ok(tour.route === '*' || tour.route.startsWith('/'), `${tour.id}: маршрут`);
  if (tour.permission) assert.ok(isKnownPermission(tour.permission), `${tour.id}: неизвестное право ${tour.permission}`);
  assert.equal(new Set(tour.steps.map((s) => s.id)).size, tour.steps.length, `${tour.id}: id шагов уникальны`);
  for (const step of tour.steps) {
    if (step.permission) assert.ok(isKnownPermission(step.permission), `${tour.id}.${step.id}: неизвестное право ${step.permission}`);
    if (step.target) assert.ok(markers.has(step.target), `${tour.id}.${step.id}: нет разметки data-tour="${step.target}"`);
    for (const text of [step.title, step.body, step.bodyMobile || '']) {
      assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${tour.id}.${step.id}: emoji в тексте`);
    }
    assert.ok(step.title.trim() && step.body.trim(), `${tour.id}.${step.id}: пустой текст`);
  }
  // Первый шаг — без «нажмите сюда»: тур начинается с объяснения, а не с действия
  assert.ok(!tour.steps[0].waitForClick, `${tour.id}: первый шаг не может ждать нажатия`);
}

// Маршруты
assert.equal(tourForPath('/')?.id, 'dashboard');
assert.equal(tourForPath('/leads')?.id, 'leads');
assert.equal(tourForPath('/leads/123')?.id, 'leads');
assert.equal(tourForPath('/rates')?.id, 'rates');
assert.equal(tourForPath('/profile'), null);
assert.equal(tourForPath('/leadsx'), null);
assert.equal(tourById('welcome')?.route, '*');

// Шаги по правам: консультант без права создавать лиды не видит шаг «Новый лид»
const consultant = new Set(['leads.menu', 'leads.scripts']);
const can = (k) => consultant.has(k);
const leads = tourById('leads');
assert.ok(isTourAvailable(leads, can));
assert.ok(!stepsFor(leads, can).some((s) => s.id === 'create'));
assert.ok(stepsFor(leads, can).some((s) => s.id === 'scripts'));
assert.ok(stepsFor(leads, () => true).some((s) => s.id === 'create'));
assert.ok(!isTourAvailable(tourById('employees'), can));
assert.ok(isTourAvailable(tourById('welcome'), () => false));

console.log(`verify-onboarding-tours: OK (${TOURS.length} туров, меток в разметке: ${markers.size})`);
