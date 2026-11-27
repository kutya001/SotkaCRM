'use client';

import * as React from 'react';
import { CheckCircle2, CircleDashed, GraduationCap, PlayCircle, SkipForward, Users, BellOff, Loader2 } from 'lucide-react';
import { DataJournal, type ColumnDef, type DataJournalTab } from '@/components/ui/DataJournal';
import { ModalCallout } from '@/components/ui/Modal';
import { EmployeeColorDot } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { api, type TrainingReportDto } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type ReportRow = TrainingReportDto['rows'][number];
type ReportCell = ReportRow['tours'][string];

const CELL_META = {
  completed: { label: 'Пройдено', icon: CheckCircle2, className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25' },
  skipped: { label: 'Пропущено', icon: SkipForward, className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25' },
  in_progress: { label: 'Начато', icon: PlayCircle, className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25' },
  none: { label: 'Не начато', icon: CircleDashed, className: 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 border-zinc-200 dark:border-zinc-700' },
} as const;

/** Метка прохождения тура: статус, шаги и время в подсказке */
function CellBadge({ cell }: { cell: ReportCell }) {
  if (!cell.applicable) return <span className="text-zinc-300 dark:text-zinc-600" title="Модуль недоступен роли">—</span>;
  const meta = CELL_META[cell.status ?? 'none'];
  const Icon = meta.icon;
  const steps = cell.status && cell.status !== 'completed' && cell.total_steps > 0 ? ` ${cell.steps_seen}/${cell.total_steps}` : '';
  const when = cell.finished_at || cell.updated_at;
  return (
    <span
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap', meta.className)}
      title={when ? `${meta.label}${steps ? `, шагов${steps}` : ''} — ${formatDateTime(when)}` : meta.label}
    >
      <Icon className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
      {meta.label}
      {steps}
    </span>
  );
}

/**
 * Прохождение обучения сотрудниками (право employees.training): строки — активные сотрудники,
 * колонки — туры модулей; «—» — модуль недоступен роли сотрудника.
 */
export function TrainingProgressPanel() {
  const { showToast } = useToast();
  const [report, setReport] = React.useState<TrainingReportDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState('all');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.onboarding.getReport());
    } catch (err: any) {
      showToast(err?.message || 'Не удалось загрузить прохождение обучения', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rows = report?.rows || [];
  const tours = report?.tours || [];

  const isDone = (r: ReportRow) => r.applicable > 0 && r.completed >= r.applicable;
  const isNotStarted = (r: ReportRow) => Object.values(r.tours).every((c) => !c.applicable || !c.status);
  const counts = {
    all: rows.length,
    done: rows.filter(isDone).length,
    partial: rows.filter((r) => !isDone(r) && !isNotStarted(r)).length,
    none: rows.filter(isNotStarted).length,
    disabled: rows.filter((r) => r.disabled_all).length,
  };

  const visibleRows = rows.filter((r) =>
    tab === 'done' ? isDone(r) : tab === 'partial' ? !isDone(r) && !isNotStarted(r) : tab === 'none' ? isNotStarted(r) : tab === 'disabled' ? r.disabled_all : true
  );

  const tabs: DataJournalTab[] = [
    { id: 'all', label: 'Все', count: counts.all, icon: Users },
    { id: 'done', label: 'Прошли все', count: counts.done, icon: CheckCircle2 },
    { id: 'partial', label: 'В процессе', count: counts.partial, icon: PlayCircle },
    { id: 'none', label: 'Не начинали', count: counts.none, icon: CircleDashed },
    { id: 'disabled', label: 'Отключили', count: counts.disabled, icon: BellOff },
  ];

  const columns: ColumnDef<ReportRow>[] = React.useMemo(
    () => [
      {
        key: 'full_name',
        label: 'Сотрудник',
        width: 220,
        sortable: true,
        filterable: true,
        cardTitle: true,
        renderCell: (row) => (
          <span className="flex items-center gap-2 min-w-0">
            <EmployeeColorDot color={row.color} size="sm" />
            <span className="truncate font-semibold">{row.full_name}</span>
            {row.disabled_all && <BellOff className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" strokeWidth={1.75} aria-label="Обучение отключено" />}
          </span>
        ),
      },
      { key: 'role_name', label: 'Роль', width: 150, sortable: true, filterable: true },
      {
        key: 'completed',
        label: 'Пройдено',
        width: 110,
        sortable: true,
        renderCell: (row) => (
          <span className={cn('font-mono text-xs font-semibold', isDone(row) ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-300')}>
            {row.completed} из {row.applicable}
          </span>
        ),
      },
      ...tours.map<ColumnDef<ReportRow>>((t) => ({
        key: `tour_${t.id}`,
        label: t.title,
        width: 140,
        renderCell: (row) => <CellBadge cell={row.tours[t.id]} />,
      })),
    ],
    [tours]
  );

  // Карточка (телефон): все модули списком
  const renderCard = React.useCallback(
    (row: ReportRow) => (
      <div className="min-w-0 rounded-3xl backdrop-blur-xl bg-white/80 dark:bg-zinc-900/80 border border-white/20 dark:border-zinc-800/40 shadow-sm p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 min-w-0">
              <EmployeeColorDot color={row.color} size="sm" />
              <span className="truncate">{row.full_name}</span>
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{row.role_name}</p>
          </div>
          <span className={cn('text-xs font-mono font-semibold flex-shrink-0', isDone(row) ? 'text-emerald-600' : 'text-zinc-500')}>
            {row.completed} из {row.applicable}
          </span>
        </div>
        {row.disabled_all && (
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <BellOff className="w-3.5 h-3.5" strokeWidth={1.75} />
            Сотрудник отключил подсказки обучения
          </p>
        )}
        <div className="space-y-1.5 border-t border-zinc-100 dark:border-zinc-800/60 pt-2.5">
          {tours
            .filter((t) => row.tours[t.id]?.applicable)
            .map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-zinc-600 dark:text-zinc-300 truncate">{t.title}</span>
                <CellBadge cell={row.tours[t.id]} />
              </div>
            ))}
        </div>
      </div>
    ),
    [tours]
  );

  return (
    <div className="space-y-3">
      {report && !report.available && (
        <ModalCallout tone="warning">
          Прохождение обучения сохраняется в базе после применения миграции 049. Пока данные хранятся только в браузере сотрудника, поэтому
          отчет пуст.
        </ModalCallout>
      )}
      {!report ? (
        <div className="py-16 flex justify-center text-zinc-400">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} /> : <span className="text-xs">Нет данных</span>}
        </div>
      ) : (
      // Колонки модулей известны только после загрузки: журнал монтируется с полным набором колонок
      <DataJournal<ReportRow>
        key={tours.map((t) => t.id).join(',')}
        data={visibleRows}
        columns={columns}
        keyField="user_id"
        storageKey="training_progress"
        title="Обучение"
        totalCount={visibleRows.length}
        emptyMessage={loading ? 'Загрузка...' : 'Нет сотрудников'}
        tabs={tabs}
        activeTab={tab}
        onTabChange={setTab}
        onRefresh={load}
        refreshing={loading}
        renderCard={renderCard}
        customActions={
          <span className="hidden lg:inline-flex items-center gap-1.5 text-[11px] text-zinc-500 px-2">
            <GraduationCap className="w-3.5 h-3.5" strokeWidth={1.75} />
            «—» — модуль недоступен роли
          </span>
        }
      />
      )}
    </div>
  );
}
