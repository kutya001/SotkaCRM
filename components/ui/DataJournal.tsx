'use client';

import * as React from 'react';
import {
  Search,
  Table2,
  LayoutGrid,
  Filter,
  RotateCcw,
  Layers,
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
import { useToast, type ToastType } from '@/components/ui/Toast';
import { useVirtualizer } from '@tanstack/react-virtual';

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
  dotColor?: string;
}

export interface ColumnFilterOption {
  value: string;
  label: string;
}

export interface ColumnDef<T> {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  type?: 'text' | 'number' | 'date' | 'status' | 'phone' | 'currency';
  filterType?: 'text' | 'select' | 'range' | 'dateRange';
  filterOptions?: ColumnFilterOption[];
  statusOptions?: StatusOption[];
  phoneAccessor?: (row: T) => string;
  renderCell?: (row: T, value: any) => React.ReactNode;
}

export interface ColumnFilterState {
  search?: string;
  selectedValues?: string[];
  rangeMin?: number | string;
  rangeMax?: number | string;
}

export type ColumnFilters = Record<string, ColumnFilterState>;

export interface DataJournalProps<T extends Record<string, any>> {
  data: T[];
  columns: ColumnDef<T>[];
  keyField: keyof T;
  storageKey?: string;
  title?: string;
  subtitle?: string;
  searchPlaceholder?: string;
  externalSearchQuery?: string;
  onSearchChange?: (query: string) => void;
  customActions?: React.ReactNode;
  customRowActions?: (row: T) => React.ReactNode;
  createTooltip?: string;
  onRowClick?: (row: T) => void;
  onStatusChange?: (row: T, newStatus: string) => void;
  onCreateClick?: () => void;
  renderCard?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  totalCount?: number;
  defaultGroupBy?: string;
  onResetAllFilters?: () => void;
}

export const PIPELINE_STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'Открыт',
    label: 'Открыт',
    colorClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    dotColor: 'bg-blue-500',
  },
  {
    value: 'Обработан',
    label: 'Обработан',
    colorClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
    dotColor: 'bg-purple-500',
  },
  {
    value: 'Назначен',
    label: 'Назначен',
    colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    dotColor: 'bg-amber-500',
  },
  {
    value: 'Подписан',
    label: 'Подписан',
    colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    dotColor: 'bg-emerald-500',
  },
  {
    value: 'Отмена',
    label: 'Отмена',
    colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    dotColor: 'bg-rose-500',
  },
];

export function isColumnFilterActive(f?: ColumnFilterState): boolean {
  if (!f) return false;
  if (f.search && f.search.trim().length > 0) return true;
  if (f.selectedValues && f.selectedValues.length > 0) return true;
  if (f.rangeMin !== undefined && f.rangeMin !== '') return true;
  if (f.rangeMax !== undefined && f.rangeMax !== '') return true;
  return false;
}

export function getColumnFilterBadgeCount(f?: ColumnFilterState): number {
  if (!f) return 0;
  if (f.selectedValues && f.selectedValues.length > 0) {
    return f.selectedValues.length;
  }
  let count = 0;
  if (f.search && f.search.trim().length > 0) count++;
  if ((f.rangeMin !== undefined && f.rangeMin !== '') || (f.rangeMax !== undefined && f.rangeMax !== '')) {
    count++;
  }
  return count;
}

export function getColumnFilterOptions<T extends Record<string, any>>(
  col: ColumnDef<T>,
  data: T[]
): { value: string; label: string; count?: number }[] {
  if (col.filterOptions && col.filterOptions.length > 0) {
    return col.filterOptions.map((opt) => ({
      ...opt,
      count: data.filter((d) => String(d[col.key] ?? '') === opt.value).length,
    }));
  }

  if (col.statusOptions && col.statusOptions.length > 0) {
    return col.statusOptions.map((opt) => ({
      value: opt.value,
      label: opt.label,
      count: data.filter((d) => String(d[col.key] ?? '') === opt.value).length,
    }));
  }

  if (col.type === 'status') {
    return PIPELINE_STATUS_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
      count: data.filter((d) => String(d[col.key] ?? '') === opt.value).length,
    }));
  }

  // Автоматическое извлечение категориальных значений из данных
  const counts = new Map<string, number>();
  for (const item of data) {
    const val = item[col.key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const strVal = String(val);
      counts.set(strVal, (counts.get(strVal) || 0) + 1);
    }
  }

  // Если уникальных значений <= 35, возвращаем их как чекбоксы
  if (counts.size > 0 && counts.size <= 35) {
    return Array.from(counts.entries()).map(([value, count]) => ({
      value,
      label: value,
      count,
    }));
  }

  return [];
}

interface ColumnFilterPopoverProps<T extends Record<string, any>> {
  column: ColumnDef<T>;
  filterState: ColumnFilterState;
  onUpdate: (updates: Partial<ColumnFilterState>) => void;
  onReset: () => void;
  onClose: () => void;
  options: { value: string; label: string; count?: number }[];
  isRightAligned?: boolean;
}

function ColumnFilterPopover<T extends Record<string, any>>({
  column,
  filterState,
  onUpdate,
  onReset,
  onClose,
  options,
  isRightAligned,
}: ColumnFilterPopoverProps<T>) {
  const [optionSearch, setOptionSearch] = React.useState('');
  const isActive = isColumnFilterActive(filterState);

  const filteredOptions = React.useMemo(() => {
    if (!optionSearch.trim()) return options;
    const q = optionSearch.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, optionSearch]);

  const isNumeric =
    column.type === 'number' || column.type === 'currency' || column.filterType === 'range';
  const isDate = column.type === 'date' || column.filterType === 'dateRange';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`absolute top-full mt-2 z-50 w-72 sm:w-80 max-w-[calc(100vw-32px)] p-3.5 rounded-2xl backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-100 ${
        isRightAligned ? 'right-0' : 'left-0 sm:left-auto sm:right-0 md:left-0'
      }`}
    >
      {/* Шапка поповера */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 min-w-0">
          <Filter className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" strokeWidth={2} />
          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {column.label}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          title="Закрыть"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>

      {/* 1. Числовой диапазон (От / До) */}
      {isNumeric && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block">
            Диапазон чисел:
          </span>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400 block mb-0.5">От</label>
              <input
                type="number"
                placeholder="Мин."
                value={filterState.rangeMin ?? ''}
                onChange={(e) => onUpdate({ rangeMin: e.target.value })}
                className="w-full h-8 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 block mb-0.5">До</label>
              <input
                type="number"
                placeholder="Макс."
                value={filterState.rangeMax ?? ''}
                onChange={(e) => onUpdate({ rangeMax: e.target.value })}
                className="w-full h-8 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* 2. Календарный диапазон дат (С даты / По дату) */}
      {isDate && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block">
            Период дат:
          </span>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400 block mb-0.5">С даты</label>
              <input
                type="date"
                value={filterState.rangeMin ?? ''}
                onChange={(e) => onUpdate({ rangeMin: e.target.value })}
                className="w-full h-8 px-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 block mb-0.5">По дату</label>
              <input
                type="date"
                value={filterState.rangeMax ?? ''}
                onChange={(e) => onUpdate({ rangeMax: e.target.value })}
                className="w-full h-8 px-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. Текстовый поиск по подстроке */}
      {!isNumeric && !isDate && (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск по подстроке..."
              value={filterState.search ?? ''}
              onChange={(e) => onUpdate({ search: e.target.value })}
              className="w-full h-8 pl-8 pr-7 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {filterState.search && (
              <button
                type="button"
                onClick={() => onUpdate({ search: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Чекбоксы уникальных/категориальных значений */}
      {options.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-zinc-200/50 dark:border-zinc-800/50">
          <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold">Категории:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    selectedValues: options.map((o) => o.value),
                  })
                }
                className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Все
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => onUpdate({ selectedValues: [] })}
                className="text-[10px] text-zinc-500 hover:underline font-medium"
              >
                Снять
              </button>
            </div>
          </div>

          {options.length > 6 && (
            <div className="relative">
              <input
                type="text"
                placeholder="Фильтр списка вариантов..."
                value={optionSearch}
                onChange={(e) => setOptionSearch(e.target.value)}
                className="w-full h-7 px-2.5 text-[11px] rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
              />
            </div>
          )}

          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {filteredOptions.map((opt) => {
              const selected = (filterState.selectedValues || []).includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer text-xs transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = filterState.selectedValues || [];
                        const next = e.target.checked
                          ? [...current, opt.value]
                          : current.filter((v) => v !== opt.value);
                        onUpdate({ selectedValues: next });
                      }}
                      className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-0 w-3.5 h-3.5"
                    />
                    <span className="truncate text-zinc-800 dark:text-zinc-200">
                      {opt.label}
                    </span>
                  </div>
                  {opt.count !== undefined && (
                    <span className="text-[10px] font-mono text-zinc-400 flex-shrink-0">
                      {opt.count}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Подвал поповера */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
        <button
          type="button"
          disabled={!isActive}
          onClick={onReset}
          className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 font-medium transition-colors"
        >
          <RotateCcw className="w-3 h-3" strokeWidth={2} />
          <span>Сбросить фильтр</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 px-3 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-semibold hover:opacity-90 transition-opacity"
        >
          Готово
        </button>
      </div>
    </div>
  );
}

interface DataJournalTableRowProps<T extends Record<string, any>> {
  row: T;
  rowKey: string;
  orderedColumns: ColumnDef<T>[];
  initialColumns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  onStatusChange?: (row: T, newStatus: string) => void;
  customRowActions?: (row: T) => React.ReactNode;
  handleCopy: (text: string, rowKey: string) => void;
  copiedKey: string | null;
  activeStatusDropdownRowKey: string | null;
  setActiveStatusDropdownRowKey: (key: string | null) => void;
  statusDropdownRef: React.RefObject<HTMLDivElement | null>;
  showToast: (msg: string, type?: ToastType) => void;
}

const DataJournalTableRowInner = <T extends Record<string, any>>({
  row,
  rowKey,
  orderedColumns,
  initialColumns,
  onRowClick,
  onStatusChange,
  customRowActions,
  handleCopy,
  copiedKey,
  activeStatusDropdownRowKey,
  setActiveStatusDropdownRowKey,
  statusDropdownRef,
  showToast,
}: DataJournalTableRowProps<T>) => {
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

          if (!onStatusChange) {
            return (
              <td key={col.key} className="px-4 py-3">
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${currentOption.colorClass}`}
                >
                  {currentOption.label}
                </span>
              </td>
            );
          }

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
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      currentOption.dotColor || 'bg-current'
                    }`}
                  />
                  <span>{currentOption.label}</span>
                  <ChevronDown className="w-3 h-3" strokeWidth={2} />
                </button>

                {isDropdownOpen && (
                  <div
                    ref={statusDropdownRef}
                    className="absolute left-0 top-8 z-50 min-w-[140px] p-1.5 rounded-2xl backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-1 animate-in fade-in zoom-in-95 duration-100"
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
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              opt.dotColor || 'bg-zinc-400'
                            }`}
                          />
                          <span>{opt.label}</span>
                        </span>
                        {opt.value === val && (
                          <Check
                            className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0"
                            strokeWidth={2}
                          />
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
                  <Copy
                    className="w-3 h-3 text-zinc-400 group-hover:opacity-100 opacity-0 transition-opacity"
                    strokeWidth={1.5}
                  />
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
          {customRowActions && customRowActions(row)}

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
};

export const DataJournalTableRow = React.memo(
  DataJournalTableRowInner
) as typeof DataJournalTableRowInner;

interface DataJournalCardProps<T extends Record<string, any>> {
  row: T;
  rowKey: string;
  orderedColumns: ColumnDef<T>[];
  initialColumns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  onStatusChange?: (row: T, newStatus: string) => void;
  customRowActions?: (row: T) => React.ReactNode;
  handleCopy: (text: string, rowKey: string) => void;
  copiedKey: string | null;
  showToast: (msg: string, type?: ToastType) => void;
}

const DataJournalCardInner = <T extends Record<string, any>>({
  row,
  rowKey,
  orderedColumns,
  initialColumns,
  onRowClick,
  onStatusChange,
  customRowActions,
  handleCopy,
  copiedKey,
  showToast,
}: DataJournalCardProps<T>) => {
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
                  {col.renderCell
                    ? col.renderCell(row, val)
                    : col.type === 'currency'
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
        <div className="flex items-center gap-1.5 flex-wrap">
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

          {customRowActions && customRowActions(row)}
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
};

export const DataJournalCard = React.memo(
  DataJournalCardInner
) as typeof DataJournalCardInner;

export function DataJournal<T extends Record<string, any>>({
  data,
  columns: initialColumns,
  keyField,
  storageKey = 'crm_journal',
  title,
  subtitle,
  searchPlaceholder = 'Поиск по всем полям...',
  externalSearchQuery,
  onSearchChange,
  customActions,
  customRowActions,
  createTooltip,
  onRowClick,
  onStatusChange,
  onCreateClick,
  renderCard,
  emptyMessage = 'Записи не найдены',
  totalCount,
  defaultGroupBy,
  onResetAllFilters,
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

  // 5. Поиск, сортировка и фильтрация в заголовках (th)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortConfig, setSortConfig] = React.useState<{
    field: string;
    order: 'asc' | 'desc' | null;
  }>({ field: '', order: null });

  // Фильтры колонок
  const [columnFilters, setColumnFilters] = React.useState<ColumnFilters>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem(`datajournal_${storageKey}_column_filters`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const [activeFilterColumnKey, setActiveFilterColumnKey] = React.useState<string | null>(null);
  const filterPopoverRef = React.useRef<HTMLDivElement | null>(null);

  // Карточный режим: фильтры и группировка
  const [isCardFiltersOpen, setIsCardFiltersOpen] = React.useState(false);
  const [expandedCardFilterCol, setExpandedCardFilterCol] = React.useState<string | null>(null);
  const cardFiltersRef = React.useRef<HTMLDivElement | null>(null);

  const [groupByField, setGroupByField] = React.useState<string | null>(() => {
    if (typeof window === 'undefined') return defaultGroupBy || null;
    try {
      const saved = localStorage.getItem(`datajournal_${storageKey}_groupby`);
      if (saved !== null) return saved || null;
    } catch {}
    return defaultGroupBy || null;
  });

  const handleGroupByChange = (field: string | null) => {
    setGroupByField(field);
    try {
      if (field) {
        localStorage.setItem(`datajournal_${storageKey}_groupby`, field);
      } else {
        localStorage.removeItem(`datajournal_${storageKey}_groupby`);
      }
    } catch {}
  };

  type ActiveDropdown = 'columns' | null;
  const [activeDropdown, setActiveDropdown] = React.useState<ActiveDropdown>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);

  // Click outside обработчик для всех поповеров и выпадающих меню
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (toolbarRef.current && !toolbarRef.current.contains(target)) {
        setActiveDropdown(null);
      }
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(target)) {
        setActiveFilterColumnKey(null);
      }
      if (cardFiltersRef.current && !cardFiltersRef.current.contains(target)) {
        setIsCardFiltersOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveDropdown(null);
        setActiveFilterColumnKey(null);
        setIsCardFiltersOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

  const updateColumnFilter = (key: string, updates: Partial<ColumnFilterState>) => {
    setColumnFilters((prev) => {
      const current = prev[key] || {};
      const nextCol = { ...current, ...updates };
      const updated = { ...prev, [key]: nextCol };
      try {
        localStorage.setItem(
          `datajournal_${storageKey}_column_filters`,
          JSON.stringify(updated)
        );
      } catch {}
      return updated;
    });
  };

  const resetColumnFilter = (key: string) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      try {
        localStorage.setItem(
          `datajournal_${storageKey}_column_filters`,
          JSON.stringify(next)
        );
      } catch {}
      return next;
    });
  };

  const resetAllFilters = () => {
    setColumnFilters({});
    setSearchQuery('');
    if (onSearchChange) onSearchChange('');
    if (onResetAllFilters) onResetAllFilters();
    try {
      localStorage.removeItem(`datajournal_${storageKey}_column_filters`);
    } catch {}
    showToast('Все фильтры сброшены', 'info');
  };

  const handleSearchInputChange = (val: string) => {
    setSearchQuery(val);
    if (onSearchChange) {
      onSearchChange(val);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    if (onSearchChange) {
      onSearchChange('');
    }
  };

  // Вычисление отфильтрованных и отсортированных данных
  const effectiveSearch =
    externalSearchQuery !== undefined ? externalSearchQuery : searchQuery;

  const totalActiveFilterCount = React.useMemo(() => {
    let count = 0;
    for (const f of Object.values(columnFilters)) {
      if (isColumnFilterActive(f)) {
        count++;
      }
    }
    if (effectiveSearch.trim()) {
      count++;
    }
    return count;
  }, [columnFilters, effectiveSearch]);

  const filteredData = React.useMemo(() => {
    return data.filter((item) => {
      // 1. Глобальный текстовый поиск по всем полям
      if (effectiveSearch.trim()) {
        const q = effectiveSearch.toLowerCase();
        const matchesAny = Object.values(item).some((val) =>
          String(val ?? '').toLowerCase().includes(q)
        );
        if (!matchesAny) return false;
      }

      // 2. Индивидуальные фильтры колонок (th)
      for (const [colKey, f] of Object.entries(columnFilters)) {
        if (!f) continue;
        const col = initialColumns.find((c) => c.key === colKey);
        const itemVal = item[colKey];
        const itemValStr = String(itemVal ?? '');

        // Поиск по подстроке
        if (f.search && f.search.trim()) {
          if (!itemValStr.toLowerCase().includes(f.search.trim().toLowerCase())) {
            return false;
          }
        }

        // Чекбоксы значений
        if (f.selectedValues && f.selectedValues.length > 0) {
          const matches = f.selectedValues.includes(itemValStr);
          if (!matches) return false;
        }

        // Числовой диапазон
        if (
          col?.type === 'number' ||
          col?.type === 'currency' ||
          col?.filterType === 'range'
        ) {
          const num = Number(itemVal);
          if (f.rangeMin !== undefined && f.rangeMin !== '') {
            if (isNaN(num) || num < Number(f.rangeMin)) return false;
          }
          if (f.rangeMax !== undefined && f.rangeMax !== '') {
            if (isNaN(num) || num > Number(f.rangeMax)) return false;
          }
        }

        // Диапазон дат
        if (col?.type === 'date' || col?.filterType === 'dateRange') {
          if (f.rangeMin !== undefined && f.rangeMin !== '') {
            const itemDate = new Date(itemVal);
            const minDate = new Date(String(f.rangeMin));
            if (!isNaN(itemDate.getTime()) && !isNaN(minDate.getTime()) && itemDate < minDate) {
              return false;
            }
          }
          if (f.rangeMax !== undefined && f.rangeMax !== '') {
            const itemDate = new Date(itemVal);
            const maxDate = new Date(`${String(f.rangeMax)}T23:59:59.999`);
            if (!isNaN(itemDate.getTime()) && !isNaN(maxDate.getTime()) && itemDate > maxDate) {
              return false;
            }
          }
        }
      }

      return true;
    });
  }, [data, effectiveSearch, columnFilters, initialColumns]);

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

  // Колонки, доступные для группировки в карточном режиме
  const groupableColumns = React.useMemo(() => {
    return initialColumns.filter(
      (col) =>
        col.groupable ||
        col.type === 'status' ||
        (col.statusOptions && col.statusOptions.length > 0) ||
        (col.filterOptions && col.filterOptions.length > 0)
    );
  }, [initialColumns]);

  // Группированные данные для карточного режима (Канбан)
  const groupedData = React.useMemo(() => {
    if (!groupByField) return [];
    const col = initialColumns.find((c) => c.key === groupByField);
    const groupsMap = new Map<
      string,
      { groupKey: string; groupLabel: string; statusOpt?: StatusOption; items: T[] }
    >();

    if (col?.statusOptions) {
      for (const opt of col.statusOptions) {
        groupsMap.set(opt.value, {
          groupKey: opt.value,
          groupLabel: opt.label,
          statusOpt: opt,
          items: [],
        });
      }
    } else if (col?.filterOptions) {
      for (const opt of col.filterOptions) {
        groupsMap.set(opt.value, {
          groupKey: opt.value,
          groupLabel: opt.label,
          items: [],
        });
      }
    }

    for (const item of sortedData) {
      const rawVal = item[groupByField];
      const groupKey = String(rawVal ?? '');
      if (!groupsMap.has(groupKey)) {
        let groupLabel = groupKey || '— Не указано —';
        if (col?.filterOptions) {
          const found = col.filterOptions.find((o) => o.value === groupKey);
          if (found) groupLabel = found.label;
        }
        groupsMap.set(groupKey, {
          groupKey,
          groupLabel,
          items: [],
        });
      }
      groupsMap.get(groupKey)!.items.push(item);
    }

    return Array.from(groupsMap.values()).filter(
      (g) => g.items.length > 0 || Boolean(col?.statusOptions)
    );
  }, [sortedData, groupByField, initialColumns]);

  // 6. Пагинация
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [effectiveSearch, columnFilters, pageSize, groupByField]);

  const hasActiveFilters = totalActiveFilterCount > 0;
  const totalRows = hasActiveFilters ? sortedData.length : (totalCount ?? sortedData.length);
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const paginatedData = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const orderedColumns = React.useMemo(() => {
    return columnsOrder
      .map((key) => initialColumns.find((c) => c.key === key)!)
      .filter((col) => col && visibleColumns[col.key] !== false);
  }, [columnsOrder, initialColumns, visibleColumns]);

  const tableContainerRef = React.useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: paginatedData.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalVirtualSize = rowVirtualizer.getTotalSize();

  // Копирование в буфер
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);
  const handleCopy = React.useCallback(
    (text: string, rowKey: string) => {
      navigator.clipboard.writeText(text);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(30);
      }
      setCopiedKey(rowKey);
      showToast('Скопировано в буфер', 'success');
      setTimeout(() => {
        setCopiedKey(null);
      }, 1500);
    },
    [showToast]
  );

  // In-cell смена статуса
  const [activeStatusDropdownRowKey, setActiveStatusDropdownRowKey] = React.useState<
    string | null
  >(null);
  const statusDropdownRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <div className="w-full space-y-4">
      {/* 1. Верхний управляющий тулбар реестра (ЯРУС 3) */}
      <div
        ref={toolbarRef}
        className="relative z-30 flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl sm:rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm min-h-[56px]"
      >
        {/* ТАБЛИЧНЫЙ ВИД: Действия + Поиск + Сброс */}
        {viewMode === 'table' ? (
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
            {customActions}
            {onCreateClick && !customActions && (
              <button
                type="button"
                onClick={onCreateClick}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shadow-md transition-all active:scale-95 island-interactive flex-shrink-0"
                title={createTooltip || 'Добавить запись'}
                aria-label={createTooltip || 'Добавить запись'}
              >
                <Plus className="w-5 h-5" strokeWidth={2.25} />
              </button>
            )}

            {/* Строка глобального поиска */}
            <div className="relative flex-1 min-w-[180px] max-w-xs sm:max-w-sm md:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={effectiveSearch}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                className="w-full h-11 pl-9 pr-8 text-xs rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {effectiveSearch && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  title="Очистить поиск"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Кнопка «Сбросить все фильтры» (появляется только при наличии активных условий) */}
            {totalActiveFilterCount > 0 && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="min-h-[44px] h-11 px-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 flex-shrink-0 shadow-sm"
                title="Сбросить все активные фильтры"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Сбросить фильтры</span>
                <span className="w-5 h-5 rounded-full bg-rose-500/20 text-[10px] font-bold flex items-center justify-center">
                  {totalActiveFilterCount}
                </span>
              </button>
            )}
          </div>
        ) : (
          /* КАРТОЧНЫЙ ВИД: [ Группировка: {Select} ] [ Фильтры {Icon + Badge} ] [ Поиск ] */
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {customActions}
            {onCreateClick && !customActions && (
              <button
                type="button"
                onClick={onCreateClick}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shadow-md transition-all active:scale-95 island-interactive flex-shrink-0"
                title={createTooltip || 'Добавить запись'}
                aria-label={createTooltip || 'Добавить запись'}
              >
                <Plus className="w-5 h-5" strokeWidth={2.25} />
              </button>
            )}

            {/* [ Группировка: {Select} ] */}
            <div className="flex items-center gap-1.5 bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 rounded-xl px-2.5 h-11">
              <Layers className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.75} />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap hidden sm:inline">
                Группировка:
              </span>
              <select
                value={groupByField || ''}
                onChange={(e) => handleGroupByChange(e.target.value || null)}
                className="bg-transparent text-xs font-semibold text-zinc-800 dark:text-zinc-200 focus:outline-none cursor-pointer"
              >
                <option value="">Без группировки</option>
                {groupableColumns.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.label}
                  </option>
                ))}
              </select>
            </div>

            {/* [ Фильтры {Icon + Badge} ] */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsCardFiltersOpen(!isCardFiltersOpen)}
                className={`min-h-[44px] h-11 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all island-interactive ${
                  totalActiveFilterCount > 0
                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'bg-white/60 dark:bg-zinc-900/60 border-zinc-200/80 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80'
                }`}
                title="Фильтры записей"
              >
                <Filter
                  className="w-4 h-4"
                  strokeWidth={totalActiveFilterCount > 0 ? 2.25 : 1.75}
                />
                <span>Фильтры</span>
                {totalActiveFilterCount > 0 && (
                  <span className="min-w-[18px] h-4.5 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {totalActiveFilterCount}
                  </span>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" strokeWidth={1.75} />
              </button>

              {/* Выпадающее меню фильтров карточного режима */}
              {isCardFiltersOpen && (
                <div
                  ref={cardFiltersRef}
                  className="absolute left-0 top-13 z-50 w-72 sm:w-80 p-3.5 rounded-2xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-blue-500" strokeWidth={2} />
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        Фильтры реестра
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCardFiltersOpen(false)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  </div>

                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {initialColumns
                      .filter((col) => col.filterable !== false)
                      .map((col) => {
                        const f = columnFilters[col.key] || {};
                        const isColFiltered = isColumnFilterActive(f);
                        const isExpanded = expandedCardFilterCol === col.key;
                        const opts = getColumnFilterOptions(col, data);

                        return (
                          <div
                            key={col.key}
                            className={`rounded-xl border transition-all ${
                              isColFiltered
                                ? 'border-blue-500/40 bg-blue-500/5'
                                : 'border-zinc-200/70 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCardFilterCol(isExpanded ? null : col.key)
                              }
                              className="w-full px-3 py-2 text-left flex items-center justify-between text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isColFiltered ? 'bg-blue-500' : 'bg-transparent'
                                  }`}
                                />
                                <span className="truncate">{col.label}</span>
                              </span>
                              <div className="flex items-center gap-1.5">
                                {isColFiltered && (
                                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                                    Активен
                                  </span>
                                )}
                                <ChevronDown
                                  className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="p-3 pt-0 space-y-2.5 border-t border-zinc-200/50 dark:border-zinc-800/50">
                                {col.type === 'number' ||
                                col.type === 'currency' ||
                                col.filterType === 'range' ? (
                                  <div className="grid grid-cols-2 gap-2 pt-2">
                                    <div>
                                      <label className="text-[10px] text-zinc-400 block mb-0.5">
                                        От
                                      </label>
                                      <input
                                        type="number"
                                        placeholder="Мин."
                                        value={f.rangeMin ?? ''}
                                        onChange={(e) =>
                                          updateColumnFilter(col.key, {
                                            rangeMin: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-zinc-400 block mb-0.5">
                                        До
                                      </label>
                                      <input
                                        type="number"
                                        placeholder="Макс."
                                        value={f.rangeMax ?? ''}
                                        onChange={(e) =>
                                          updateColumnFilter(col.key, {
                                            rangeMax: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-mono"
                                      />
                                    </div>
                                  </div>
                                ) : col.type === 'date' || col.filterType === 'dateRange' ? (
                                  <div className="grid grid-cols-2 gap-2 pt-2">
                                    <div>
                                      <label className="text-[10px] text-zinc-400 block mb-0.5">
                                        С даты
                                      </label>
                                      <input
                                        type="date"
                                        value={f.rangeMin ?? ''}
                                        onChange={(e) =>
                                          updateColumnFilter(col.key, {
                                            rangeMin: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-zinc-400 block mb-0.5">
                                        По дату
                                      </label>
                                      <input
                                        type="date"
                                        value={f.rangeMax ?? ''}
                                        onChange={(e) =>
                                          updateColumnFilter(col.key, {
                                            rangeMax: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="pt-2 space-y-2">
                                    <input
                                      type="text"
                                      placeholder="Поиск по значению..."
                                      value={f.search ?? ''}
                                      onChange={(e) =>
                                        updateColumnFilter(col.key, {
                                          search: e.target.value,
                                        })
                                      }
                                      className="w-full h-8 px-2.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs"
                                    />
                                    {opts.length > 0 && (
                                      <div className="max-h-32 overflow-y-auto space-y-1">
                                        {opts.map((opt) => {
                                          const selected = (
                                            f.selectedValues || []
                                          ).includes(opt.value);
                                          return (
                                            <label
                                              key={opt.value}
                                              className="flex items-center justify-between text-xs cursor-pointer py-0.5"
                                            >
                                              <span className="flex items-center gap-2 truncate">
                                                <input
                                                  type="checkbox"
                                                  checked={selected}
                                                  onChange={(e) => {
                                                    const cur = f.selectedValues || [];
                                                    const nxt = e.target.checked
                                                      ? [...cur, opt.value]
                                                      : cur.filter((v) => v !== opt.value);
                                                    updateColumnFilter(col.key, {
                                                      selectedValues: nxt,
                                                    });
                                                  }}
                                                  className="rounded border-zinc-300 text-blue-600"
                                                />
                                                <span className="truncate">{opt.label}</span>
                                              </span>
                                              {opt.count !== undefined && (
                                                <span className="text-[10px] text-zinc-400 font-mono">
                                                  {opt.count}
                                                </span>
                                              )}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {isColFiltered && (
                                  <button
                                    type="button"
                                    onClick={() => resetColumnFilter(col.key)}
                                    className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 font-medium pt-1"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Сбросить колонку</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
                    <button
                      type="button"
                      disabled={totalActiveFilterCount === 0}
                      onClick={resetAllFilters}
                      className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 font-medium"
                    >
                      <RotateCcw className="w-3 h-3" strokeWidth={2} />
                      <span>Сбросить все</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCardFiltersOpen(false)}
                      className="h-7 px-3 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-semibold"
                    >
                      Применить
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* [ Поиск ] */}
            <div className="relative flex-1 min-w-[160px] max-w-xs sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={effectiveSearch}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                className="w-full h-11 pl-9 pr-8 text-xs rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {effectiveSearch && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Кнопка «Сбросить» (если активно) */}
            {totalActiveFilterCount > 0 && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="min-h-[44px] h-11 px-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-all flex-shrink-0"
                title="Сбросить все активные фильтры"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Сбросить</span>
              </button>
            )}
          </div>
        )}

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
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] font-medium text-zinc-400">Активные фильтры:</span>
          {Object.entries(columnFilters).map(([colKey, f]) => {
            const col = initialColumns.find((c) => c.key === colKey);
            if (!isColumnFilterActive(f)) return null;
            const label = col?.label || colKey;
            let desc = '';
            if (f.search) desc += `"${f.search}" `;
            if (f.selectedValues && f.selectedValues.length > 0) {
              if (col?.statusOptions) {
                const names = f.selectedValues
                  .map((v) => col.statusOptions?.find((o) => o.value === v)?.label || v)
                  .join(', ');
                desc += names + ' ';
              } else if (col?.filterOptions) {
                const names = f.selectedValues
                  .map((v) => col.filterOptions?.find((o) => o.value === v)?.label || v)
                  .join(', ');
                desc += names + ' ';
              } else {
                desc += f.selectedValues.join(', ') + ' ';
              }
            }
            if (f.rangeMin !== undefined && f.rangeMin !== '') desc += `от ${f.rangeMin} `;
            if (f.rangeMax !== undefined && f.rangeMax !== '') desc += `до ${f.rangeMax} `;

            return (
              <span
                key={colKey}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs border border-blue-500/20"
              >
                <span className="font-semibold">{label}:</span>
                <span className="truncate max-w-[160px]">{desc.trim()}</span>
                <button
                  type="button"
                  onClick={() => resetColumnFilter(colKey)}
                  className="hover:text-rose-500 ml-0.5"
                  title="Снять фильтр"
                >
                  <X className="w-3 h-3" strokeWidth={2} />
                </button>
              </span>
            );
          })}

          <button
            type="button"
            onClick={resetAllFilters}
            className="text-[11px] text-zinc-400 hover:text-rose-500 underline ml-1 transition-colors"
          >
            Сбросить все
          </button>
        </div>
      )}

      {/* 2. Представление данных: Таблица или Карточки */}
      {isClient && viewMode === 'table' ? (
        /* ТАБЛИЧНЫЙ ВИД (TABLE VIEW) */
        <div className="relative z-10 w-full overflow-hidden rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm min-h-[360px]">
          <div ref={tableContainerRef} className="overflow-x-auto overflow-y-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              {/* Sticky-шапка */}
              <thead className="sticky top-0 z-20 backdrop-blur-2xl bg-zinc-100/90 dark:bg-zinc-900/95 border-b border-zinc-200/80 dark:border-zinc-800">
                <tr>
                  {orderedColumns.map((col, colIndex) => {
                    const width = columnWidths[col.key] || 160;
                    const isSorted = sortConfig.field === col.key;
                    const colFilter = columnFilters[col.key] || {};
                    const isColFiltered = isColumnFilterActive(colFilter);
                    const filterBadge = getColumnFilterBadgeCount(colFilter);
                    const isFilterOpen = activeFilterColumnKey === col.key;
                    const options = getColumnFilterOptions(col, data);
                    const isRightAligned = colIndex >= orderedColumns.length - 2;

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
                        <div className="flex items-center justify-between gap-1.5">
                          {/* Сортировка и заголовок */}
                          <div
                            onClick={() => col.sortable !== false && handleSort(col.key)}
                            className={`flex items-center gap-1.5 flex-1 min-w-0 ${
                              col.sortable !== false
                                ? 'cursor-pointer hover:text-zinc-900 dark:hover:text-white'
                                : ''
                            }`}
                          >
                            <GripVertical
                              className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 cursor-grab transition-opacity flex-shrink-0"
                              strokeWidth={1.75}
                            />
                            <span className="truncate">{col.label}</span>
                            {col.sortable !== false && (
                              <span className="text-zinc-400 flex-shrink-0">
                                {isSorted ? (
                                  sortConfig.order === 'asc' ? (
                                    <ArrowUp
                                      className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100"
                                      strokeWidth={2}
                                    />
                                  ) : (
                                    <ArrowDown
                                      className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100"
                                      strokeWidth={2}
                                    />
                                  )
                                ) : (
                                  <ArrowUpDown
                                    className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"
                                    strokeWidth={1.5}
                                  />
                                )}
                              </span>
                            )}
                          </div>

                          {/* Кнопка воронки фильтра колонки */}
                          {col.filterable !== false && (
                            <div className="relative flex-shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveFilterColumnKey(
                                    isFilterOpen ? null : col.key
                                  );
                                }}
                                className={`p-1.5 rounded-lg transition-all flex items-center gap-1 ${
                                  isColFiltered
                                    ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-sm'
                                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
                                }`}
                                title={`Фильтр: ${col.label}`}
                                aria-label={`Фильтр по колонке ${col.label}`}
                              >
                                <Filter
                                  className="w-3.5 h-3.5"
                                  strokeWidth={isColFiltered ? 2.25 : 1.75}
                                />
                                {filterBadge > 0 && (
                                  <span className="min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                                    {filterBadge}
                                  </span>
                                )}
                              </button>

                              {/* Контекстный поповер фильтра колонки */}
                              {isFilterOpen && (
                                <div ref={filterPopoverRef}>
                                  <ColumnFilterPopover
                                    column={col}
                                    filterState={colFilter}
                                    onUpdate={(updates) =>
                                      updateColumnFilter(col.key, updates)
                                    }
                                    onReset={() => resetColumnFilter(col.key)}
                                    onClose={() => setActiveFilterColumnKey(null)}
                                    options={options}
                                    isRightAligned={isRightAligned}
                                  />
                                </div>
                              )}
                            </div>
                          )}

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
                      className="px-4 py-16 text-center text-zinc-400"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  <>
                    {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                      <tr>
                        <td
                          colSpan={orderedColumns.length + 1}
                          style={{
                            height: `${virtualRows[0].start}px`,
                            padding: 0,
                            border: 0,
                          }}
                        />
                      </tr>
                    )}
                    {virtualRows.map((virtualRow) => {
                      const row = paginatedData[virtualRow.index];
                      if (!row) return null;
                      const rowKey = String(row[keyField]);
                      return (
                        <DataJournalTableRow
                          key={rowKey}
                          row={row}
                          rowKey={rowKey}
                          orderedColumns={orderedColumns}
                          initialColumns={initialColumns}
                          onRowClick={onRowClick}
                          onStatusChange={onStatusChange}
                          customRowActions={customRowActions}
                          handleCopy={handleCopy}
                          copiedKey={copiedKey}
                          activeStatusDropdownRowKey={activeStatusDropdownRowKey}
                          setActiveStatusDropdownRowKey={setActiveStatusDropdownRowKey}
                          statusDropdownRef={statusDropdownRef}
                          showToast={showToast}
                        />
                      );
                    })}
                    {virtualRows.length > 0 &&
                      totalVirtualSize - virtualRows[virtualRows.length - 1].end > 0 && (
                        <tr>
                          <td
                            colSpan={orderedColumns.length + 1}
                            style={{
                              height: `${totalVirtualSize - virtualRows[virtualRows.length - 1].end}px`,
                              padding: 0,
                              border: 0,
                            }}
                          />
                        </tr>
                      )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : isClient && viewMode === 'cards' && groupByField ? (
        /* КАРТОЧНЫЙ РЕЖИМ С ГРУППИРОВКОЙ (КАНБАН ПО КОЛОНКАМ) */
        <div className="relative z-10 space-y-6">
          {groupedData.length === 0 ? (
            <div className="p-8 text-center rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 text-xs text-zinc-400">
              {emptyMessage}
            </div>
          ) : (
            groupedData.map((group) => (
              <div key={group.groupKey} className="space-y-3">
                {/* Шапка группы */}
                <div className="flex items-center justify-between px-3 py-2 rounded-2xl bg-zinc-100/80 dark:bg-zinc-800/70 border border-zinc-200/60 dark:border-zinc-700/60">
                  <div className="flex items-center gap-2">
                    {group.statusOpt ? (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${group.statusOpt.colorClass}`}
                      >
                        {group.statusOpt.label}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {group.groupLabel}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[10px] font-mono font-bold">
                      {group.items.length}
                    </span>
                  </div>
                </div>

                {/* Карточки группы */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.items.map((row) => {
                    const rowKey = String(row[keyField]);
                    if (renderCard) {
                      return (
                        <React.Fragment key={rowKey}>
                          {renderCard(row)}
                        </React.Fragment>
                      );
                    }
                    return (
                      <DataJournalCard
                        key={rowKey}
                        row={row}
                        rowKey={rowKey}
                        orderedColumns={orderedColumns}
                        initialColumns={initialColumns}
                        onRowClick={onRowClick}
                        onStatusChange={onStatusChange}
                        customRowActions={customRowActions}
                        handleCopy={handleCopy}
                        copiedKey={copiedKey}
                        showToast={showToast}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* СТАНДАРТНЫЙ КАРТОЧНЫЙ ВИД */
        <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginatedData.length === 0 ? (
            <div className="col-span-full p-8 text-center rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 text-xs text-zinc-400">
              {emptyMessage}
            </div>
          ) : renderCard ? (
            paginatedData.map((row) => (
              <React.Fragment key={String(row[keyField])}>
                {renderCard(row)}
              </React.Fragment>
            ))
          ) : (
            paginatedData.map((row) => {
              const rowKey = String(row[keyField]);
              return (
                <DataJournalCard
                  key={rowKey}
                  row={row}
                  rowKey={rowKey}
                  orderedColumns={orderedColumns}
                  initialColumns={initialColumns}
                  onRowClick={onRowClick}
                  onStatusChange={onStatusChange}
                  customRowActions={customRowActions}
                  handleCopy={handleCopy}
                  copiedKey={copiedKey}
                  showToast={showToast}
                />
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
