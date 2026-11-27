// Проверка скриптов продаж (lib/sales): подстановки, тарифы в текстах, уникальность и разделы.
// Запуск: node --experimental-strip-types scripts/verify-sales-scripts.mjs
import assert from 'node:assert/strict';
import { SALES_SCRIPTS, SALES_SCRIPT_CATEGORIES, fillScript, manualFieldsOf, matchesScript } from '../lib/sales/scripts.ts';
import { PLATFORM_TARIFFS, formatTariffPrice, plural } from '../lib/sales/tariffs.ts';

// Уникальные id, известные разделы, непустые тексты
assert.equal(new Set(SALES_SCRIPTS.map((s) => s.id)).size, SALES_SCRIPTS.length, 'id скриптов уникальны');
for (const s of SALES_SCRIPTS) {
  assert.ok(SALES_SCRIPT_CATEGORIES.includes(s.category), `${s.id}: неизвестный раздел ${s.category}`);
  assert.ok(s.text.trim().length > 20, `${s.id}: пустой текст`);
  assert.ok(!/\[Имя\]|undefined|NaN/.test(s.text), `${s.id}: необработанная подстановка`);
}
for (const c of SALES_SCRIPT_CATEGORIES) assert.ok(SALES_SCRIPTS.some((s) => s.category === c), `раздел ${c} пуст`);

// Цены и тарифы — из каталога
assert.equal(formatTariffPrice(1499), '1 499 сом');
assert.equal(plural(1, 'точка', 'точки', 'точек'), 'точка');
assert.equal(plural(3, 'точка', 'точки', 'точек'), 'точки');
assert.equal(plural(30, 'сотрудника', 'сотрудников', 'сотрудников'), 'сотрудников');
const prices = SALES_SCRIPTS.find((s) => s.id === 'tariffs-prices').text;
for (const t of PLATFORM_TARIFFS) {
  assert.ok(prices.includes(`${t.name} — ${formatTariffPrice(t.price)}`), `в ценах нет тарифа ${t.name}`);
  assert.ok(SALES_SCRIPTS.some((s) => s.id === `tariff-${t.id}` && s.text.includes(formatTariffPrice(t.price))), `нет скрипта тарифа ${t.name}`);
}
assert.match(SALES_SCRIPTS.find((s) => s.id === 'tariff-premium').text, /модуль рассрочек/);
assert.match(SALES_SCRIPTS.find((s) => s.id === 'tariff-basic').text, /Модуля рассрочек в «Базовом» нет/);
assert.match(SALES_SCRIPTS.find((s) => s.id === 'tariff-business').text, /IMEI/);
assert.match(SALES_SCRIPTS.find((s) => s.id === 'objection-price').text, /около 50 сом в день/);
const byId = (id) => SALES_SCRIPTS.find((s) => s.id === id);
assert.match(byId('greet-price').text, /Подключение бесплатное/);
assert.ok(byId('greet-price').text.includes(formatTariffPrice(PLATFORM_TARIFFS[0].price)), 'в ответе о цене — цена «Базового»');
assert.match(byId('tariff-recommend-premium').text, /2 599 сом/);
const about = byId('about-platform').text;
for (const part of ['Sotka Market', 'IMEI', 'POS-терминал', 'https://sotka.kg']) assert.ok(about.includes(part), `о платформе: нет «${part}»`);
// Emoji запрещены в интерфейсе CRM — тексты скриптов показываются в нем
for (const s of SALES_SCRIPTS) assert.ok(!/\p{Extended_Pictographic}/u.test(s.text + s.title), `${s.id}: emoji в тексте`);

// Подстановки
const greet = 'Здравствуйте, {имя}! Меня зовут {менеджер}, Sotka.kg.';
assert.equal(fillScript(greet, { clientName: 'Азамат', managerName: 'Кутман' }), 'Здравствуйте, Азамат! Меня зовут Кутман, Sotka.kg.');
assert.equal(fillScript(greet, { clientName: '  ', managerName: 'Кутман' }), 'Здравствуйте! Меня зовут Кутман, Sotka.kg.');
assert.equal(fillScript(greet, {}), 'Здравствуйте! Меня зовут [ваше имя], Sotka.kg.');
assert.equal(fillScript('{имя}, подскажите, вы ИП?', {}), 'Подскажите, вы ИП?');
assert.equal(fillScript('{имя}, подскажите, вы ИП?', { clientName: 'Айгуль' }), 'Айгуль, подскажите, вы ИП?');
assert.equal(fillScript('Строка 1\n• пункт  два', {}), 'Строка 1\n• пункт два');
assert.equal(fillScript('Записал вас, {имя}. Будем к [16:00].', {}), 'Записал вас. Будем к [16:00].');
assert.equal(fillScript('Абзац\n\nВторой', {}), 'Абзац\n\nВторой');
for (const s of SALES_SCRIPTS) {
  const filled = fillScript(s.text, {});
  assert.ok(!/\{имя\}|\{менеджер\}/.test(filled), `${s.id}: подстановка осталась без имени клиента`);
}

// Поля для ручного заполнения и поиск
assert.deepEqual(manualFieldsOf('Удобно [дата и время] в [ТЦ / рынок]?'), ['дата и время', 'ТЦ / рынок']);
assert.ok(matchesScript(SALES_SCRIPTS.find((s) => s.id === 'qualify-legal'), 'осоо'));
assert.ok(!matchesScript(SALES_SCRIPTS.find((s) => s.id === 'qualify-legal'), 'imei'));

console.log(`verify-sales-scripts: OK (${SALES_SCRIPTS.length} скриптов)`);
