// Проверка журнала версий (lib/changelog.ts): формат версий и дат, порядок от новых к старым,
// версия в package.json и package-lock.json совпадает с первой записью, нет emoji (правило интерфейса).
// Запуск: node --experimental-strip-types scripts/verify-changelog.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, CHANGELOG, compareVersions, entriesSince } from '../lib/changelog.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

assert.ok(CHANGELOG.length > 0, 'журнал пуст');
assert.equal(APP_VERSION, CHANGELOG[0].version);
assert.equal(pkg.version, APP_VERSION, 'package.json: версия не совпадает с первой записью журнала');
assert.equal(lock.version, APP_VERSION, 'package-lock.json: версия не совпадает');
assert.equal(lock.packages[''].version, APP_VERSION, 'package-lock.json (packages[""]): версия не совпадает');

const seen = new Set();
for (let i = 0; i < CHANGELOG.length; i++) {
  const e = CHANGELOG[i];
  assert.match(e.version, /^\d+\.\d+\.\d+$/, `${e.version}: формат MAJOR.MINOR.PATCH`);
  assert.ok(!seen.has(e.version), `${e.version}: повтор`);
  seen.add(e.version);
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `${e.version}: дата ГГГГ-ММ-ДД`);
  assert.ok(!Number.isNaN(Date.parse(e.date)), `${e.version}: некорректная дата`);
  assert.ok(e.title.trim(), `${e.version}: нет заголовка`);
  const items = [...(e.added || []), ...(e.changed || []), ...(e.fixed || [])];
  assert.ok(items.length > 0, `${e.version}: нет пунктов`);
  for (const t of [e.title, ...items]) {
    assert.ok(t.trim().length > 0, `${e.version}: пустой пункт`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${e.version}: emoji в тексте`);
  }
  if (i > 0) {
    const prev = CHANGELOG[i - 1];
    assert.ok(compareVersions(prev.version, e.version) > 0, `${prev.version} должна быть новее ${e.version}`);
    assert.ok(prev.date >= e.date, `${prev.version}: дата раньше, чем у ${e.version}`);
  }
}

assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
assert.equal(compareVersions('1.2.0', '1.2'), 0);
assert.deepEqual(entriesSince(null).map((e) => e.version), [APP_VERSION]);
assert.deepEqual(entriesSince(APP_VERSION), []);
assert.ok(entriesSince('1.0.0').length === CHANGELOG.length - 1);

console.log(`verify-changelog: OK (${CHANGELOG.length} версий, текущая ${APP_VERSION})`);
