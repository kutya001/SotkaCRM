/**
 * Порядок колонок канбана, сохраненный в браузере (localStorage), применяется к текущим колонкам:
 * сначала колонки в сохраненном порядке, затем новые (которых не было при сохранении) — в исходном
 * порядке модуля. Удаленные колонки и повторы в сохраненном списке пропускаются.
 */
export function applyKanbanColumnOrder<C extends { id: string }>(columns: C[], savedOrder: readonly string[] | null | undefined): C[] {
  if (!savedOrder || savedOrder.length === 0) return columns;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const used = new Set<string>();
  const ordered: C[] = [];
  for (const id of savedOrder) {
    const column = byId.get(id);
    if (column && !used.has(id)) {
      ordered.push(column);
      used.add(id);
    }
  }
  for (const column of columns) {
    if (!used.has(column.id)) ordered.push(column);
  }
  return ordered;
}

/** Перестановка: элемент с индексом from переносится на место to (как при перетаскивании) */
export function moveKanbanColumn(ids: readonly string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Разбор сохраненного порядка: только массив строк, иначе null (поврежденное значение игнорируется) */
export function parseKanbanColumnOrder(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
  } catch {
    return null;
  }
}
