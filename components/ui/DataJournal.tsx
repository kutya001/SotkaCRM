'use client';

import * as React from 'react';
import {
  Search,
  Table2,
  LayoutGrid,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  MessageCircle,
  Copy,
  Check,
  Plus,
  Trash2,
  X,
  Phone,
  GripVertical,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

export type FilterOperator = 'equals' | 'contains' | 'gt' | 'lt' | 'neq';

export interface FilterRule {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface StatusOption {
  value: string;
  label: string;
  colorClass: string;
}

export interface ColumnDef<T> {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  filterable?: boolean;
  type?: 'text' | 'number' | 'date' | 'status' | 'phone' | 'currency';
  statusOptions?: StatusOption[];
  phoneAccessor?: (row: T) => string;
  renderCell?: (row: T, value: any) => React.ReactNode;
}

export interface DataJournalProps<T extends Record<string, any>> {
  data: T[];
  columns: ColumnDef<T>[];
  keyField: keyof T;
  storageKey?: string;
  title?: string;
  subtitle?: string;
  searchPlaceholder?: string;
  externalSearchQuery?: string;
  customActions?: React.ReactNode;
  createTooltip?: string;
  onRowClick?: (row: T) => void;
  onStatusChange?: (row: T, newStatus: string) => void;
  onCreateClick?: () => void;
  emptyMessage?: string;
  totalCount?: number;
}

export const PIPELINE_STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'Открыт',
    label: 'Открыт',
    colorClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  },
  {
    value: 'Обработан',
    label: 'Обработан',
    colorClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
  },
  {
    value: 'Назначен',
    label: 'Назначен',
    colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  {
    value: 'Подписан',
    label: 'Подписан',
    colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  },
  {
    value: 'Отмена',
    label: 'Отмена',
    colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  },
];

export function DataJournal<T extends Record<string, any>>({
  data,
  columns: initialColumns,
  keyField,
  storageKey = 'crm_journal',
  title,
  subtitle,
  searchPlaceholder = 'Поиск по всем полям...',
  externalSearchQuery,
  customActions,
  createTooltip,
  onRowClick,
  onStatusChange,
  onCreateClick,
  emptyMessage = 'Записи не найдены',
  totalCount,
}: DataJournalProps<T>) {
  const { showToast } = useToast();

  // 1. Режим отображения: Таблица / Карточки
  const [viewMode, setViewMode] = React.useState<'table' | 'cards'>('table');
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
    const isMobile = window.innerWidth < 1024;
    const savedView = localStorage.getItem(`datajournal_${storageKey}_view`);
    if (savedView === 'table' || savedView === 'cards') {
      setViewMode(savedView);
    } else {
      setViewMode(isMobile ? 'cards' : 'table');
    }
  }, [storageKey]);

  const handleToggleView = (mode: 'table' | 'cards') => {
    setViewMode(mode);
    localStorage.setItem(`datajournal_${storageKey}_view`, mode);
  };

  // 2. Очередность и видимость колонок
  const [columnsOrder, setColumnsOrder] = React.useState<string[]>(() =>
    initialColumns.map((c) => c.key)
  );
  const [visibleColumns, setVisibleColumns] = React.useState<Record<string, boolean>>(() =>
    initialColumns.reduce((acc, col) => ({ ...acc, [col.key]: true }), {})
  );
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>(() =>
    initialColumns.reduce(
      (acc, col) => ({ ...acc, [col.key]: col.width || 160 }),
      {}
    )
  );

  React.useEffect(() => {
    try {
      const savedOrder = localStorage.getItem(`datajournal_${storageKey}_order`);
      if (savedOrder) {
        const parsedOrder = JSON.parse(savedOrder) as string[];
        if (Array.isArray(parsedOrder) && parsedOrder.length === initialColumns.length) {
          setColumnsOrder(parsedOrder);
        }
      }

      const savedVis = localStorage.getItem(`datajournal_${storageKey}_visibility`);
      if (savedVis) {
        setVisibleColumns(JSON.parse(savedVis));
      }

      const savedWidths = localStorage.getItem(`datajournal_${storageKey}_widths`);
      if (savedWidths) {
        setColumnWidths(JSON.parse(savedWidths));
      }
    } catch {
      // Игнорируем ошибки парсинга localStorage
    }
  }, [storageKey, initialColumns]);

  const toggleColumnVisibility = (key: string) => {
    const updated = { ...visibleColumns, [key]: !visibleColumns[key] };
    setVisibleColumns(updated);
    localStorage.setItem(`datajournal_${storageKey}_visibility`, JSON.stringify(updated));
  };

  // 3. Drag-to-resize колонок таблицы
  const resizingRef = React.useRef<{
    columnKey: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeStart = (e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = columnWidths[columnKey] || 160;
    resizingRef.current = {
      columnKey,
      startX: e.clientX,
      startWidth: currentWidth,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = moveEvent.clientX - resizingRef.current.startX;
      const minW = initialColumns.find((c) => c.key === columnKey)?.minWidth || 80;
      const newWidth = Math.max(minW, resizingRef.current.startWidth + delta);

      setColumnWidths((prev) => {
        const updated = { ...prev, [columnKey]: newWidth };
        return updated;
      });
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        localStorage.setItem(
          `datajournal_${storageKey}_widths`,
          JSON.stringify(columnWidths)
        );
      }
      resizingRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 4. Drag-and-drop перестановка колонок
  const [draggedColumnKey, setDraggedColumnKey] = React.useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, key: string) => {
    e.dataTransfer.setData('text/plain', key);
    setDraggedColumnKey(key);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const sourceKey = draggedColumnKey || e.dataTransfer.getData('text/plain');
    if (!sourceKey || sourceKey === targetKey) return;

    const newOrder = [...columnsOrder];
    const sourceIndex = newOrder.indexOf(sourceKey);
    const targetIndex = newOrder.indexOf(targetKey);

    if (sourceIndex !== -1 && targetIndex !== -1) {
      newOrder.splice(sourceIndex, 1);
      newOrder.splice(targetIndex, 0, sourceKey);
      setColumnsOrder(newOrder);
      localStorage.setItem(
        `datajournal_${storageKey}_order`,
        JSON.stringify(newOrder)
      );
    }
    setDraggedColumnKey(null);
  };

  // 5. Поиск, фильтры и сортировка
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortConfig, setSortConfig] = React.useState<{
    field: string;
    order: 'asc' | 'desc' | null;
  }>({ field: '', order: null });

  type ActiveDropdown = 'filters' | 'columns' | null;
  const [filterRules, setFilterRules] = React.useState<FilterRule[]>([]);
  const [activeDropdown, setActiveDropdown] = React.useState<ActiveDropdown>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(event.target as Node)
      ) {
        setActiveDropdown(null);
      }
    }

    if (activeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeDropdown]);

  const toggleDropdown = (type: ActiveDropdown) => {
    setActiveDropdown((prev) => (prev === type ? null : type));
  };

  const handleSort = (field: string) => {
    setSortConfig((prev) => {
      if (prev.field !== field) return { field, order: 'asc' };
      if (prev.order === 'asc') return { field, order: 'desc' };
      return { field: '', order: null };
    });
  };

  const addFilterRule = () => {
    const firstFilterable = initialColumns.find((c) => c.filterable !== false);
    if (!firstFilterable) return;
    const newRule: FilterRule = {
      id: Math.random().toString(36).substring(2, 9),
      field: firstFilterable.key,
      operator: 'contains',
      value: '',
    };
    setFilterRules((prev) => [...prev, newRule]);
  };

  const updateFilterRule = (id: string, updates: Partial<FilterRule>) => {
    setFilterRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  const removeFilterRule = (id: string) => {
    setFilterRules((prev) => prev.filter((r) => r.id !== id));
  };

  // Вычисление отфильтрованных и отсортированных данных
  const effectiveSearch =
    externalSearchQuery !== undefined ? externalSearchQuery : searchQuery;

  const filteredData = React.useMemo(() => {
    return data.filter((item) => {
      // Текстовый поиск
      if (effectiveSearch.trim()) {
        const q = effectiveSearch.toLowerCase();
        const matchesAny = Object.values(item).some((val) =>
          String(val ?? '').toLowerCase().includes(q)
        );
        if (!matchesAny) return false;
      }

      // Пользовательские правила фильтра
      for (const rule of filterRules) {
        if (!rule.value.trim()) continue;
        const itemVal = item[rule.field];
        const valStr = String(itemVal ?? '').toLowerCase();
        const ruleValStr = rule.value.toLowerCase();
        const numItemVal = Number(itemVal);
        const numRuleVal = Number(rule.value);

        if (rule.operator === 'equals') {
          if (valStr !== ruleValStr) return false;
        } else if (rule.operator === 'neq') {
          if (valStr === ruleValStr) return false;
        } else if (rule.operator === 'contains') {
          if (!valStr.includes(ruleValStr)) return false;
        } else if (rule.operator === 'gt') {
          if (isNaN(numItemVal) || isNaN(numRuleVal) || numItemVal <= numRuleVal)
            return false;
        } else if (rule.operator === 'lt') {
          if (isNaN(numItemVal) || isNaN(numRuleVal) || numItemVal >= numRuleVal)
            return false;
        }
      }

      return true;
    });
  }, [data, effectiveSearch, filterRules]);

  const sortedData = React.useMemo(() => {
    if (!sortConfig.field || !sortConfig.order) return filteredData;
    const { field, order } = sortConfig;
    return [...filteredData].sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return order === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return order === 'asc'
        ? String(aVal).localeCompare(String(bVal), 'ru')
        : String(bVal).localeCompare(String(aVal), 'ru');
    });
  }, [filteredData, sortConfig]);

  // 6. Пагинация
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [effectiveSearch, filterRules, pageSize]);

  const totalRows = totalCount ?? sortedData.length;
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const paginatedData = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const orderedColumns = React.useMemo(() => {
    return columnsOrder
      .map((key) => initialColumns.find((c) => c.key === key)!)
      .filter((col) => col && visibleColumns[col.key] !== false);
  }, [columnsOrder, initialColumns, visibleColumns]);

  // Копирование в буфер
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);
  const handleCopy = (text: string, rowKey: string) => {
    navigator.clipboard.writeText(text);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(30);
    }
    setCopiedKey(rowKey);
    showToast('Скопировано в буфер', 'success');
    setTimeout(() => {
      setCopiedKey(null);
    }, 1500);
  };

  // In-cell смена статуса
  const [activeStatusDropdownRowKey, setActiveStatusDropdownRowKey] = React.useState<
    string | null
  >(null);

  const statusDropdownRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(event.target as Node)
      ) {
        setActiveStatusDropdownRowKey(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="w-full space-y-4">
      {/* 1. Верхний управляющий тулбар реестра (ЯРУС 3) */}
      <div
        ref={toolbarRef}
        className="relative z-30 flex items-center justify-between gap-3 p-3 rounded-2xl sm:rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm min-h-[56px]"
      >
        {/* Слева: Контекстные действия страницы ([Скрипты продаж], [+] и т.д.) */}
        <div className="flex items-center gap-2">
          {customActions}
          {onCreateClick && !customActions && (
            <button
              type="button"
              onClick={onCreateClick}
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shadow-md transition-all active:scale-95 island-interactive"
              title={createTooltip || 'Добавить запись'}
              aria-label={createTooltip || 'Добавить запись'}
            >
              <Plus className="w-5 h-5" strokeWidth={2.25} />
            </button>
          )}
        </div>

        {/* Справа: [Колонки] и [Таблица / Карточки] */}
        <div className="flex items-center gap-2">
          {/* Меню настройки видимости колонок */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleDropdown('columns')}
              className={`min-w-[44px] min-h-[44px] h-11 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all island-interactive ${
                activeDropdown === 'columns'
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent shadow-sm'
                  : 'bg-white/60 dark:bg-zinc-900/60 border-zinc-200/80 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80'
              }`}
              title="Настройка отображаемых колонок"
              aria-label="Колонки"
            >
              <Table2 className="w-4 h-4" strokeWidth={1.75} />
              <span className="hidden sm:inline">Колонки</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" strokeWidth={1.75} />
            </button>

            {activeDropdown === 'columns' && (
              <div className="absolute right-0 top-13 z-50 w-56 p-3.5 rounded-2xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-zinc-200/60 dark:border-zinc-800/60 pb-2">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Видимость колонок
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveDropdown(null)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </button>
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {initialColumns.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer text-xs text-zinc-800 dark:text-zinc-200"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns[col.key] !== false}
                        onChange={() => toggleColumnVisibility(col.key)}
                        className="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-0"
                      />
                      <span className="truncate">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Переключатель вида (Таблица / Карточки) */}
          <div className="flex items-center bg-zinc-200/60 dark:bg-zinc-800/60 p-1 rounded-xl border border-zinc-200/40 dark:border-zinc-700/40 h-11">
            <button
              onClick={() => handleToggleView('table')}
              className={`min-w-[36px] min-h-[36px] p-2 rounded-lg transition-all flex items-center justify-center ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
              title="Табличный вид"
              aria-label="Табличный вид"
            >
              <Table2 className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => handleToggleView('cards')}
              className={`min-w-[36px] min-h-[36px] p-2 rounded-lg transition-all flex items-center justify-center ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
              title="Карточный вид"
              aria-label="Карточный вид"
            >
              <LayoutGrid className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* Индикаторы активных фильтров (Чипы) */}
      {filterRules.some((r) => r.value.trim()) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] font-medium text-zinc-400">Фильтры:</span>
          {filterRules
            .filter((r) => r.value.trim())
            .map((rule) => {
              const col = initialColumns.find((c) => c.key === rule.field);
              return (
                <span
                  key={rule.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-200/70 dark:bg-zinc-800/80 text-zinc-800 dark:text-zinc-200 text-xs border border-zinc-300/40 dark:border-zinc-700/40"
                >
                  <span className="font-semibold">{col?.label || rule.field}:</span>
                  <span>{rule.value}</span>
                  <button
                    onClick={() => removeFilterRule(rule.id)}
                    className="hover:text-rose-500 ml-0.5"
                  >
                    <X className="w-3 h-3" strokeWidth={2} />
                  </button>
                </span>
              );
            })}
        </div>
      )}

      {/* 2. Представление данных: Таблица или Карточки */}
      {isClient && viewMode === 'table' ? (
        /* ТАБЛИЧНЫЙ ВИД (TABLE VIEW) */
        <div className="relative z-10 w-full overflow-hidden rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm">
          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              {/* Sticky-шапка */}
              <thead className="sticky top-0 z-20 backdrop-blur-2xl bg-zinc-100/90 dark:bg-zinc-900/95 border-b border-zinc-200/80 dark:border-zinc-800">
                <tr>
                  {orderedColumns.map((col) => {
                    const width = columnWidths[col.key] || 160;
                    const isSorted = sortConfig.field === col.key;
                    return (
                      <th
                        key={col.key}
                        style={{ width: `${width}px`, minWidth: `${col.minWidth || 80}px` }}
                        draggable
                        onDragStart={(e) => handleDragStart(e, col.key)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, col.key)}
                        className={`relative group px-4 py-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300 select-none ${
                          draggedColumnKey === col.key ? 'opacity-40' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div
                            onClick={() => col.sortable !== false && handleSort(col.key)}
                            className={`flex items-center gap-1.5 flex-1 ${
                              col.sortable !== false
                                ? 'cursor-pointer hover:text-zinc-900 dark:hover:text-white'
                                : ''
                            }`}
                          >
                            <GripVertical
                              className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 cursor-grab transition-opacity"
                              strokeWidth={1.75}
                            />
                            <span className="truncate">{col.label}</span>
                            {col.sortable !== false && (
                              <span className="text-zinc-400">
                                {isSorted ? (
                                  sortConfig.order === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100" strokeWidth={2} />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100" strokeWidth={2} />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
                                )}
                              </span>
                            )}
                          </div>

                          {/* Интерактивный разделитель для ресайза ширины (drag-to-resize) */}
                          <div
                            onMouseDown={(e) => handleResizeStart(e, col.key)}
                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-600 transition-colors"
                          />
                        </div>
                      </th>
                    );
                  })}

                  {/* Закрепленная правая колонка действий */}
                  <th className="sticky right-0 z-30 w-28 px-4 py-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300 text-right backdrop-blur-2xl bg-zinc-100/95 dark:bg-zinc-900/95 shadow-[-4px_0_12px_rgba(0,0,0,0.03)] dark:shadow-[-4px_0_12px_rgba(0,0,0,0.2)]">
                    Действия
                  </th>
                </tr>
              </thead>

              {/* Тело таблицы */}
              <tbody className="divide-y divide-zinc-200/50 dark:divide-zinc-800/50 text-xs text-zinc-800 dark:text-zinc-200">
                {paginatedData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={orderedColumns.length + 1}
                      className="px-4 py-12 text-center text-zinc-400"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((row) => {
                    const rowKey = String(row[keyField]);
                    return (
                      <tr
                        key={rowKey}
                        className="group hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40 transition-colors"
                      >
                        {orderedColumns.map((col) => {
                          const val = row[col.key];

                          if (col.renderCell) {
                            return (
                              <td
                                key={col.key}
                                onClick={() => onRowClick && onRowClick(row)}
                                className="px-4 py-3 truncate cursor-pointer"
                              >
                                {col.renderCell(row, val)}
                              </td>
                            );
                          }

                          if (col.type === 'status') {
                            const currentOption =
                              (col.statusOptions || PIPELINE_STATUS_OPTIONS).find(
                                (o) => o.value === val
                              ) || {
                                value: String(val),
                                label: String(val),
                                colorClass: 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30',
                              };

                            const isDropdownOpen =
                              activeStatusDropdownRowKey === `${rowKey}_${col.key}`;

                            return (
                              <td key={col.key} className="px-4 py-3 relative">
                                <div className="inline-block relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveStatusDropdownRowKey(
                                        isDropdownOpen ? null : `${rowKey}_${col.key}`
                                      );
                                    }}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${currentOption.colorClass} hover:opacity-90 transition-all`}
                                  >
                                    <span>{currentOption.label}</span>
                                    <ChevronDown className="w-3 h-3" strokeWidth={2} />
                                  </button>

                                  {isDropdownOpen && (
                                    <div
                                      ref={statusDropdownRef}
                                      className="absolute left-0 top-8 z-50 min-w-[130px] p-1.5 rounded-2xl backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-1 animate-in fade-in zoom-in-95 duration-100"
                                    >
                                      {(col.statusOptions || PIPELINE_STATUS_OPTIONS).map((opt) => (
                                        <button
                                          key={opt.value}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveStatusDropdownRowKey(null);
                                            onStatusChange && onStatusChange(row, opt.value);
                                            showToast(`Статус изменен на «${opt.label}»`, 'success');
                                          }}
                                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                                            opt.value === val
                                              ? 'bg-zinc-100 dark:bg-zinc-800 font-bold'
                                              : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50'
                                          }`}
                                        >
                                          <span>{opt.label}</span>
                                          {opt.value === val && (
                                            <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          }

                          if (col.type === 'phone') {
                            const phoneStr = String(val || '');
                            return (
                              <td key={col.key} className="px-4 py-3 truncate">
                                <span
                                  onClick={() => handleCopy(phoneStr, `${rowKey}_${col.key}`)}
                                  className="inline-flex items-center gap-1.5 cursor-pointer font-mono hover:text-zinc-900 dark:hover:text-white"
                                  title="Нажмите для копирования"
                                >
                                  <span>{phoneStr || '—'}</span>
                                  {copiedKey === `${rowKey}_${col.key}` ? (
                                    <Check className="w-3 h-3 text-emerald-500" strokeWidth={2} />
                                  ) : (
                                    <Copy className="w-3 h-3 text-zinc-400 group-hover:opacity-100 opacity-0 transition-opacity" strokeWidth={1.5} />
                                  )}
                                </span>
                              </td>
                            );
                          }

                          if (col.type === 'currency') {
                            const num = Number(val) || 0;
                            return (
                              <td
                                key={col.key}
                                onClick={() => onRowClick && onRowClick(row)}
                                className="px-4 py-3 font-semibold truncate cursor-pointer"
                              >
                                {num.toLocaleString('ru-RU')} сом
                              </td>
                            );
                          }

                          return (
                            <td
                              key={col.key}
                              onClick={() => onRowClick && onRowClick(row)}
                              className="px-4 py-3 truncate cursor-pointer max-w-xs"
                            >
                              {String(val ?? '—')}
                            </td>
                          );
                        })}

                        {/* Закрепленные действия */}
                        <td className="sticky right-0 z-10 px-4 py-3 text-right backdrop-blur-2xl bg-white/90 dark:bg-zinc-900/90 shadow-[-4px_0_12px_rgba(0,0,0,0.03)] dark:shadow-[-4px_0_12px_rgba(0,0,0,0.2)]">
                          <div className="flex items-center justify-end gap-1.5">
                            {onRowClick && (
                              <button
                                onClick={() => onRowClick(row)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors"
                                title="Просмотр записи"
                              >
                                <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                              </button>
                            )}

                            {(() => {
                              const phoneCol = initialColumns.find((c) => c.type === 'phone');
                              const rawPhone = phoneCol?.phoneAccessor
                                ? phoneCol.phoneAccessor(row)
                                : phoneCol
                                ? String(row[phoneCol.key] || '')
                                : '';
                              const cleanDigits = rawPhone.replace(/\D/g, '');
                              if (!cleanDigits) return null;
                              return (
                                <a
                                  href={`https://wa.me/${cleanDigits}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                                  title="Написать в WhatsApp"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                                </a>
                              );
                            })()}

                            <button
                              onClick={() => handleCopy(rowKey, rowKey)}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors"
                              title="Скопировать ID записи"
                            >
                              {copiedKey === rowKey ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                              ) : (
                                <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* КАРТОЧНЫЙ ВИД (CARD VIEW ДЛЯ МОБИЛЬНЫХ) */
        <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginatedData.length === 0 ? (
            <div className="col-span-full p-8 text-center rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 text-xs text-zinc-400">
              {emptyMessage}
            </div>
          ) : (
            paginatedData.map((row) => {
              const rowKey = String(row[keyField]);
              const phoneCol = initialColumns.find((c) => c.type === 'phone');
              const rawPhone = phoneCol?.phoneAccessor
                ? phoneCol.phoneAccessor(row)
                : phoneCol
                ? String(row[phoneCol.key] || '')
                : '';
              const cleanDigits = rawPhone.replace(/\D/g, '');

              const statusCol = initialColumns.find((c) => c.type === 'status');
              const statusVal = statusCol ? row[statusCol.key] : null;
              const currentStatusOpt =
                statusCol &&
                ((statusCol.statusOptions || PIPELINE_STATUS_OPTIONS).find(
                  (o) => o.value === statusVal
                ) || {
                  value: String(statusVal),
                  label: String(statusVal),
                  colorClass: 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30',
                });

              const titleCol = orderedColumns.find(
                (c) => c.type !== 'status' && c.type !== 'phone' && c.key !== 'id'
              );
              const cardTitle = titleCol ? String(row[titleCol.key] || 'Без названия') : rowKey;

              return (
                <div
                  key={rowKey}
                  onClick={() => onRowClick && onRowClick(row)}
                  className="rounded-3xl backdrop-blur-xl bg-white/80 dark:bg-zinc-900/80 border border-white/20 dark:border-zinc-800/40 shadow-sm p-4 space-y-3 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 line-clamp-1">
                        {cardTitle}
                      </h3>
                      <p className="text-[10px] font-mono text-zinc-400 mt-0.5">
                        ID: {rowKey.substring(0, 8)}...
                      </p>
                    </div>

                    {currentStatusOpt && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${currentStatusOpt.colorClass}`}
                      >
                        {currentStatusOpt.label}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300 border-t border-b border-zinc-100 dark:border-zinc-800/60 py-2.5">
                    {orderedColumns
                      .filter((c) => c !== titleCol && c.type !== 'status')
                      .slice(0, 4)
                      .map((col) => {
                        const val = row[col.key];
                        return (
                          <div key={col.key} className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400 text-[11px]">{col.label}:</span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[60%]">
                              {col.type === 'currency'
                                ? `${Number(val || 0).toLocaleString('ru-RU')} сом`
                                : String(val ?? '—')}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  <div
                    className="flex items-center justify-between gap-1.5 pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1.5">
                      {cleanDigits && (
                        <>
                          <a
                            href={`tel:${cleanDigits}`}
                            className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                            title="Позвонить"
                          >
                            <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </a>

                          <a
                            href={`https://wa.me/${cleanDigits}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            title="WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </a>
                        </>
                      )}

                      <button
                        onClick={() => handleCopy(rowKey, rowKey)}
                        className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        title="Скопировать ID"
                      >
                        {copiedKey === rowKey ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                        ) : (
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>

                    {statusCol && onStatusChange && (
                      <select
                        value={String(statusVal || '')}
                        onChange={(e) => {
                          onStatusChange(row, e.target.value);
                          showToast(`Статус изменен на «${e.target.value}»`, 'success');
                        }}
                        className="h-8 px-2 text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-800 dark:text-zinc-200 focus:outline-none"
                      >
                        {(statusCol.statusOptions || PIPELINE_STATUS_OPTIONS).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 3. Подвал пагинации */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <span>Строк на странице:</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 px-2.5 text-xs bg-white/60 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-800 dark:text-zinc-200 focus:outline-none"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="hidden sm:inline">
            (Показано {sortedData.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}–
            {Math.min(currentPage * pageSize, sortedData.length)} из {totalRows})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Предыдущая страница"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
          </button>

          <span className="px-3 py-1 font-semibold text-zinc-800 dark:text-zinc-200">
            {currentPage} / {totalPages}
          </span>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Следующая страница"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
