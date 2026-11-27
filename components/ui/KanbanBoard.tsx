'use client';

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  rectIntersection,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { GripHorizontal, GripVertical, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { applyKanbanColumnOrder, moveKanbanColumn, parseKanbanColumnOrder } from '@/lib/utils/kanban-order';

/** Колонка доски: значение группировки, в которое переносится карточка */
export interface KanbanColumn {
  id: string;
  label: string;
  icon?: React.ElementType;
  /** Классы метки (фон, текст, рамка) */
  colorClass?: string;
  /** Классы точки (bg-*) — если нет значка */
  dotColor?: string;
  /** Цвет точки в HEX */
  color?: string | null;
  /** Своя отметка вместо значка или точки (например, цвет сотрудника) */
  marker?: React.ReactNode;
}

/** Способ раскладки доски (например, по статусам или по ответственным) */
export interface KanbanGrouping<T> {
  id: string;
  label: string;
  icon?: React.ElementType;
  columns: KanbanColumn[];
  getColumnId: (row: T) => string;
}

/** true — перенос разрешен, строка — причина запрета */
export type KanbanMoveCheck = true | string;

export interface KanbanConfig<T> {
  groupings: KanbanGrouping<T>[];
  /** Можно ли перенести строку в колонку (текущая колонка не проверяется) */
  canMove: (row: T, groupingId: string, columnId: string) => KanbanMoveCheck;
  /** Перенос: исключение — ошибка (тост), иначе карточка остается там, где ее покажут данные */
  onMove: (row: T, groupingId: string, columnId: string) => void | boolean | Promise<void | boolean>;
  /** Содержимое карточки; без него — заголовок и подзаголовок из DataJournal */
  renderCard?: (row: T, groupingId: string) => React.ReactNode;
}

interface KanbanBoardProps<T> {
  rows: T[];
  getRowKey: (row: T) => string;
  config: KanbanConfig<T>;
  storageKey: string;
  onRowClick?: (row: T) => void;
  onRowContextMenu?: (e: React.MouseEvent, row: T) => void;
  /** Карточка по умолчанию: заголовок и подзаголовок строки */
  getCardText: (row: T) => { title: string; subtitle: string | null };
  emptyMessage?: string;
}

/** Идентификатор зоны сброса колонки в пределах группировки */
function columnDropId(groupingId: string, columnId: string): string {
  return `${groupingId}::${columnId}`;
}

function ColumnDot({ column }: { column: KanbanColumn }) {
  if (column.marker) return <>{column.marker}</>;
  if (column.icon) {
    const Icon = column.icon;
    return <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />;
  }
  if (column.color) {
    return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: column.color }} />;
  }
  return <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${column.dotColor || 'bg-zinc-400'}`} />;
}

function DraggableCard({
  id,
  disabled,
  dragHint,
  children,
  onClick,
  onContextMenu,
}: {
  id: string;
  disabled: boolean;
  dragHint: string;
  children: React.ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled, data: { type: 'card' } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={dragHint}
      className={`group relative rounded-2xl border p-3 text-xs bg-white/90 dark:bg-zinc-900/90 border-zinc-200/80 dark:border-zinc-800 shadow-sm transition-opacity select-none touch-manipulation [-webkit-touch-callout:none] ${
        disabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'opacity-30' : 'hover:border-zinc-300 dark:hover:border-zinc-700'}`}
    >
      {!disabled && (
        <GripVertical
          className="absolute right-1.5 top-1.5 w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      {children}
    </div>
  );
}

function SortableColumn({
  dropId,
  column,
  count,
  state,
  children,
}: {
  dropId: string;
  column: KanbanColumn;
  count: number;
  /** idle — перетаскивания нет; allowed / blocked / source — во время переноса карточки */
  state: 'idle' | 'allowed' | 'blocked' | 'source';
  children: React.ReactNode;
}) {
  // Колонка — и зона сброса карточек, и сортируемый элемент (перетаскивается за ручку в заголовке).
  // Запрещенная колонка остается зоной сброса: при отпускании проверка покажет причину запрета.
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging, isOver } = useSortable({
    id: dropId,
    data: { type: 'column' },
  });
  const stateClass =
    state === 'allowed'
      ? isOver
        ? 'ring-2 ring-blue-500/70 bg-blue-500/5'
        : 'ring-1 ring-blue-500/30'
      : state === 'blocked'
      ? isOver
        ? 'opacity-60 ring-2 ring-rose-500/50'
        : 'opacity-45'
      : '';
  return (
    <section
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${Math.round(transform.x)}px, 0, 0)` : undefined, transition }}
      aria-label={`${column.label}: ${count}`}
      className={`flex flex-col w-[min(18rem,82vw)] flex-shrink-0 max-h-[calc(100vh-300px)] min-h-[16rem] rounded-3xl backdrop-blur-xl bg-white/60 dark:bg-zinc-900/60 border border-white/20 dark:border-zinc-800/40 shadow-sm ${
        isDragging ? 'opacity-40' : ''
      } ${stateClass}`}
    >
      <header className="flex items-center justify-between gap-1.5 pl-1.5 pr-3.5 pt-3 pb-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Переместить колонку «${column.label}»`}
          title="Перетащите, чтобы поменять колонки местами (на телефоне — удерживайте). Порядок сохраняется в этом браузере"
          className="h-7 w-6 flex-shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 cursor-grab active:cursor-grabbing touch-manipulation select-none [-webkit-touch-callout:none]"
        >
          <GripHorizontal className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <span
          className={`inline-flex items-center gap-1.5 min-w-0 mr-auto px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            column.colorClass || 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20'
          }`}
        >
          <ColumnDot column={column} />
          <span className="truncate">{column.label}</span>
        </span>
        <span className="px-2 py-0.5 rounded-full bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] font-mono font-bold flex-shrink-0">
          {count}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-2">{children}</div>
    </section>
  );
}

/**
 * Доска канбан для DataJournal: колонки — значения выбранной группировки, карточки переносятся
 * мышью, долгим нажатием на сенсорном экране или клавиатурой (пробел — взять, стрелки, пробел — положить).
 * Разрешенные колонки подсвечиваются, запрещенные гаснут; перенос в запрещенную показывает причину.
 * Колонки переставляются за ручку в заголовке; порядок каждой раскладки хранится только в localStorage.
 */
export function KanbanBoard<T>({
  rows,
  getRowKey,
  config,
  storageKey,
  onRowClick,
  onRowContextMenu,
  getCardText,
  emptyMessage = 'Записи не найдены',
}: KanbanBoardProps<T>) {
  const { showToast } = useToast();
  const { groupings, canMove, onMove, renderCard } = config;

  const groupingStorageKey = `datajournal_${storageKey}_kanban_grouping`;
  const [groupingId, setGroupingId] = React.useState<string>(groupings[0]?.id || '');
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(groupingStorageKey);
      if (saved && groupings.some((g) => g.id === saved)) setGroupingId(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupingStorageKey]);
  const selectGrouping = (id: string) => {
    setGroupingId(id);
    try {
      localStorage.setItem(groupingStorageKey, id);
    } catch {}
  };
  const grouping = groupings.find((g) => g.id === groupingId) || groupings[0];

  // Порядок колонок каждой раскладки — только в этом браузере (localStorage), на сервер не уходит
  const orderStorageKey = (id: string) => `datajournal_${storageKey}_kanban_order_${id}`;
  const groupingIdsKey = groupings.map((g) => g.id).join('|');
  const [savedOrders, setSavedOrders] = React.useState<Record<string, string[]>>({});
  React.useEffect(() => {
    const next: Record<string, string[]> = {};
    for (const id of groupingIdsKey.split('|')) {
      try {
        const order = parseKanbanColumnOrder(localStorage.getItem(`datajournal_${storageKey}_kanban_order_${id}`));
        if (order) next[id] = order;
      } catch {}
    }
    setSavedOrders(next);
  }, [storageKey, groupingIdsKey]);
  const saveColumnOrder = (id: string, order: string[] | null) => {
    setSavedOrders((prev) => {
      const next = { ...prev };
      if (order) next[id] = order;
      else delete next[id];
      return next;
    });
    try {
      if (order) localStorage.setItem(orderStorageKey(id), JSON.stringify(order));
      else localStorage.removeItem(orderStorageKey(id));
    } catch {}
  };
  const columns = React.useMemo(
    () => applyKanbanColumnOrder(grouping.columns, savedOrders[grouping.id]),
    [grouping, savedOrders]
  );
  const hasCustomOrder = Boolean(savedOrders[grouping.id]);
  const [activeColumnDropId, setActiveColumnDropId] = React.useState<string | null>(null);

  // Перенос, ожидающий ответа сервера: карточка сразу показывается в новой колонке
  const [pending, setPending] = React.useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const suppressClickRef = React.useRef(0);
  // Долгое нажатие на Android вызывает и контекстное меню: во время и сразу после переноса оно не открывается
  const draggingRef = React.useRef(false);

  const rowsByKey = React.useMemo(() => new Map(rows.map((r) => [getRowKey(r), r])), [rows, getRowKey]);
  const activeRow = activeKey ? rowsByKey.get(activeKey) ?? null : null;

  const columnOf = React.useCallback(
    (row: T) => pending[getRowKey(row)] ?? grouping.getColumnId(row),
    [pending, grouping, getRowKey]
  );

  const byColumn = React.useMemo(() => {
    const map = new Map<string, T[]>(grouping.columns.map((c) => [c.id, []]));
    for (const row of rows) {
      const list = map.get(columnOf(row));
      if (list) list.push(row);
    }
    return map;
  }, [rows, grouping, columnOf]);

  // Строки вне колонок группировки (неизвестное значение) — показываются в отдельной сводке
  const unplaced = rows.length - Array.from(byColumn.values()).reduce((sum, list) => sum + list.length, 0);

  const checkFor = React.useCallback(
    (row: T, columnId: string): KanbanMoveCheck =>
      columnOf(row) === columnId ? true : canMove(row, grouping.id, columnId),
    [canMove, grouping, columnOf]
  );

  // Карточку можно взять, если ее есть куда перенести
  const movableKeys = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const current = columnOf(row);
      if (grouping.columns.some((c) => c.id !== current && canMove(row, grouping.id, c.id) === true)) {
        set.add(getRowKey(row));
      }
    }
    return set;
  }, [rows, grouping, canMove, columnOf, getRowKey]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Долгое нажатие: обычный свайп прокручивает доску, а не тащит карточку
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Колонку ставят по ближайшему центру соседней колонки, карточку — по пересечению с колонкой
  const collisionDetection: CollisionDetection = (args) =>
    args.active.data.current?.type === 'column' ? closestCenter(args) : rectIntersection(args);

  const handleDragStart = (e: DragStartEvent) => {
    draggingRef.current = true;
    if (e.active.data.current?.type === 'column') {
      setActiveColumnDropId(String(e.active.id));
      return;
    }
    setActiveKey(String(e.active.id));
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(20);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    draggingRef.current = false;
    setActiveKey(null);
    setActiveColumnDropId(null);
    suppressClickRef.current = Date.now();
    const overId = e.over ? String(e.over.id) : null;
    const prefix = `${grouping.id}::`;

    // Перестановка колонок: порядок сохраняется для текущей раскладки
    if (e.active.data.current?.type === 'column') {
      const activeId = String(e.active.id);
      if (!overId || overId === activeId || !overId.startsWith(prefix) || !activeId.startsWith(prefix)) return;
      const ids = columns.map((c) => c.id);
      saveColumnOrder(grouping.id, moveKanbanColumn(ids, activeId.slice(prefix.length), overId.slice(prefix.length)));
      return;
    }

    const row = rowsByKey.get(String(e.active.id));
    if (!row || !overId) return;
    if (!overId.startsWith(prefix)) return;
    const columnId = overId.slice(prefix.length);
    const key = getRowKey(row);
    if (columnOf(row) === columnId) return;

    const check = canMove(row, grouping.id, columnId);
    if (check !== true) {
      showToast(check, 'error');
      return;
    }

    setPending((prev) => ({ ...prev, [key]: columnId }));
    try {
      await onMove(row, grouping.id, columnId);
    } catch (err: any) {
      showToast(err?.message || 'Не удалось перенести карточку', 'error');
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const columnState = (columnId: string): 'idle' | 'allowed' | 'blocked' | 'source' => {
    if (!activeRow) return 'idle';
    if (columnOf(activeRow) === columnId) return 'source';
    return checkFor(activeRow, columnId) === true ? 'allowed' : 'blocked';
  };

  const renderCardBody = (row: T) => {
    if (renderCard) return renderCard(row, grouping.id);
    const { title, subtitle } = getCardText(row);
    return (
      <div className="min-w-0 pr-4">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{title}</div>
        {subtitle && <div className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{subtitle}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-3" data-no-swipe="">
      {/* Раскладка доски и сброс порядка колонок */}
      {(groupings.length > 1 || hasCustomOrder) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {groupings.length > 1 && (
          <>
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Колонки:</span>
          <div className="inline-flex items-center bg-zinc-200/60 dark:bg-zinc-800/60 p-0.5 rounded-xl border border-zinc-200/40 dark:border-zinc-700/40">
            {groupings.map((g) => {
              const Icon = g.icon;
              const selected = g.id === grouping.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => selectGrouping(g.id)}
                  aria-pressed={selected}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    selected
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  {g.label}
                </button>
              );
            })}
          </div>
          </>
          )}
          {hasCustomOrder && (
            <button
              type="button"
              onClick={() => saveColumnOrder(grouping.id, null)}
              className="h-8 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
              title="Вернуть исходный порядок колонок этой раскладки"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
              Исходный порядок
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-8 text-center rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 text-xs text-zinc-400">
          {emptyMessage}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            draggingRef.current = false;
            suppressClickRef.current = Date.now();
            setActiveKey(null);
            setActiveColumnDropId(null);
          }}
        >
          <SortableContext items={columns.map((c) => columnDropId(grouping.id, c.id))} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
            {columns.map((column) => {
              const items = byColumn.get(column.id) || [];
              return (
                <SortableColumn
                  key={column.id}
                  dropId={columnDropId(grouping.id, column.id)}
                  column={column}
                  count={items.length}
                  state={columnState(column.id)}
                >
                  {items.length === 0 ? (
                    <div className="h-20 rounded-2xl border border-dashed border-zinc-300/70 dark:border-zinc-700/70 flex items-center justify-center text-[11px] text-zinc-400">
                      Перетащите сюда
                    </div>
                  ) : (
                    items.map((row) => {
                      const key = getRowKey(row);
                      const movable = movableKeys.has(key);
                      return (
                        <DraggableCard
                          key={key}
                          id={key}
                          disabled={!movable}
                          dragHint={movable ? 'Перетащите в другую колонку (на телефоне — удерживайте)' : 'Эту карточку нельзя перенести'}
                          onClick={() => {
                            if (Date.now() - suppressClickRef.current < 250) return;
                            onRowClick?.(row);
                          }}
                          onContextMenu={
                            onRowContextMenu
                              ? (e) => {
                                  e.preventDefault();
                                  if (draggingRef.current || Date.now() - suppressClickRef.current < 800) return;
                                  onRowContextMenu(e, row);
                                }
                              : undefined
                          }
                        >
                          {renderCardBody(row)}
                        </DraggableCard>
                      );
                    })
                  )}
                </SortableColumn>
              );
            })}
          </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeColumnDropId ? (
              (() => {
                const column = columns.find((c) => columnDropId(grouping.id, c.id) === activeColumnDropId);
                if (!column) return null;
                return (
                  <div className="w-[min(18rem,82vw)] rounded-3xl border border-blue-500/40 bg-white dark:bg-zinc-900 shadow-2xl px-3.5 py-3 flex items-center justify-between gap-2 cursor-grabbing">
                    <span
                      className={`inline-flex items-center gap-1.5 min-w-0 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        column.colorClass || 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20'
                      }`}
                    >
                      <ColumnDot column={column} />
                      <span className="truncate">{column.label}</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-zinc-200/80 dark:bg-zinc-800 text-[10px] font-mono font-bold">
                      {(byColumn.get(column.id) || []).length}
                    </span>
                  </div>
                );
              })()
            ) : activeRow ? (
              <div className="rounded-2xl border p-3 text-xs bg-white dark:bg-zinc-900 border-blue-500/40 shadow-2xl rotate-1 w-[min(17rem,78vw)] cursor-grabbing">
                {renderCardBody(activeRow)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {unplaced > 0 && (
        <p className="px-1 text-[11px] text-zinc-400">Не показано на доске (значение вне колонок): {unplaced}</p>
      )}
    </div>
  );
}
