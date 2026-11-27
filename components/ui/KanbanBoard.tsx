'use client';

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
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

function DroppableColumn({
  dropId,
  column,
  count,
  state,
  children,
}: {
  dropId: string;
  column: KanbanColumn;
  count: number;
  /** idle — перетаскивания нет; allowed / blocked / source — во время перетаскивания */
  state: 'idle' | 'allowed' | 'blocked' | 'source';
  children: React.ReactNode;
}) {
  // Запрещенная колонка остается зоной сброса: при отпускании проверка покажет причину запрета
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
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
      aria-label={`${column.label}: ${count}`}
      className={`flex flex-col w-[min(18rem,82vw)] flex-shrink-0 max-h-[calc(100vh-300px)] min-h-[16rem] rounded-3xl backdrop-blur-xl bg-white/60 dark:bg-zinc-900/60 border border-white/20 dark:border-zinc-800/40 shadow-sm transition-all ${stateClass}`}
    >
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
        <span
          className={`inline-flex items-center gap-1.5 min-w-0 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
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
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (e: DragStartEvent) => {
    draggingRef.current = true;
    setActiveKey(String(e.active.id));
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(20);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    draggingRef.current = false;
    setActiveKey(null);
    suppressClickRef.current = Date.now();
    const row = rowsByKey.get(String(e.active.id));
    const overId = e.over ? String(e.over.id) : null;
    if (!row || !overId) return;
    const prefix = `${grouping.id}::`;
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
      {/* Раскладка доски */}
      {groupings.length > 1 && (
        <div className="flex items-center gap-2 px-1">
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
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-8 text-center rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 text-xs text-zinc-400">
          {emptyMessage}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => {
            draggingRef.current = false;
            suppressClickRef.current = Date.now();
            setActiveKey(null);
          }}>
          <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
            {grouping.columns.map((column) => {
              const items = byColumn.get(column.id) || [];
              return (
                <DroppableColumn
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
                </DroppableColumn>
              );
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeRow ? (
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
