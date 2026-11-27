// Проверка порядка колонок канбана (lib/utils/kanban-order.ts): применение сохраненного порядка,
// перестановка и разбор значения из localStorage.
// Запуск: node --experimental-strip-types scripts/verify-kanban-order.mjs
import assert from 'node:assert/strict';
import { applyKanbanColumnOrder, moveKanbanColumn, parseKanbanColumnOrder } from '../lib/utils/kanban-order.ts';

const cols = ['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'].map((id) => ({ id }));
const ids = (list) => list.map((c) => c.id);

// Без сохранения — исходный порядок модуля
assert.deepEqual(ids(applyKanbanColumnOrder(cols, null)), ['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена']);
assert.deepEqual(ids(applyKanbanColumnOrder(cols, [])), ids(cols));

// Сохраненный порядок применяется полностью
const saved = ['Отмена', 'Подписан', 'Назначен', 'Обработан', 'Открыт'];
assert.deepEqual(ids(applyKanbanColumnOrder(cols, saved)), saved);

// Новая колонка (например, новый консультант) — в конец; удаленная и повторы — пропускаются
assert.deepEqual(
  ids(applyKanbanColumnOrder([...cols, { id: 'Новая' }], ['Назначен', 'Удаленная', 'Назначен', 'Открыт'])),
  ['Назначен', 'Открыт', 'Обработан', 'Подписан', 'Отмена', 'Новая']
);

// Перестановка вправо и влево, на то же место и с неизвестным id — без изменений
assert.deepEqual(moveKanbanColumn(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd']);
assert.deepEqual(moveKanbanColumn(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']);
assert.deepEqual(moveKanbanColumn(['a', 'b'], 'a', 'a'), ['a', 'b']);
assert.deepEqual(moveKanbanColumn(['a', 'b'], 'x', 'a'), ['a', 'b']);

// Разбор значения из localStorage: поврежденное или чужое значение игнорируется
assert.deepEqual(parseKanbanColumnOrder('["a","b"]'), ['a', 'b']);
assert.equal(parseKanbanColumnOrder(null), null);
assert.equal(parseKanbanColumnOrder('мусор'), null);
assert.equal(parseKanbanColumnOrder('{"a":1}'), null);
assert.equal(parseKanbanColumnOrder('[1,2]'), null);

console.log('verify-kanban-order: OK');
