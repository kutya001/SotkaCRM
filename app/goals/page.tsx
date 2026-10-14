'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CollapsibleStats } from '@/components/ui/CollapsibleStats';
import { DataJournal, type ColumnDef, type DataJournalTab } from '@/components/ui/DataJournal';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select, Textarea } from '@/components/ui/Field';
import { useUser } from '@/components/auth/AuthProvider';
import { api, type PlanItem, type PlanEmployee } from '@/lib/api/client';
import { todayISODate } from '@/lib/utils/format';
import {
  PLAN_PERIOD_KINDS,
  PLAN_PERIOD_LABELS,
  PLAN_SCOPE_LABELS,
  PLAN_STATUS_LABELS,
  formatPeriodLabel,
  normalizePeriodStart,
  type PlanPeriodKind,
  type PlanScope,
} from '@/lib/plans/periods';
import { Target, Plus, Users, User, Trash2, Pencil, RotateCcw, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';

const FORM_ID = 'plan-form';

const STATUS_CLASS: Record<PlanItem['progress_status'], string> = {
  done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  active: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  overdue: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  upcoming: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
};

function ProgressBar({ item }: { item: PlanItem }) {
  const pct = Math.min(100, item.percent);
  const onTrack = item.progress_status === 'done' || item.actual_count / item.target_count >= item.elapsed_share;
  const color = item.progress_status === 'done' ? 'bg-emerald-500' : item.progress_status === 'overdue' ? 'bg-rose-500' : onTrack ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="min-w-[140px] space-y-1">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="font-bold text-zinc-900 dark:text-zinc-100">
          {item.actual_count} / {item.target_count}
        </span>
        <span className="text-zinc-500">{item.percent}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        {item.progress_status === 'active' && (
          <div className="absolute top-0 bottom-0 w-px bg-zinc-500/60" style={{ left: `${Math.round(item.elapsed_share * 100)}%` }} title="Прошло времени периода" />
        )}
      </div>
    </div>
  );
}

interface PlanForm {
  scope: PlanScope;
  user_id: string;
  period_kind: PlanPeriodKind;
  period_date: string;
  target_count: string;
  note: string;
}

export default function GoalsPage() {
  const { showToast } = useToast();
  const user = useUser();
  const isAdmin = user.can('goals.manage');
  const today = todayISODate();

  const [items, setItems] = React.useState<PlanItem[]>([]);
  const [employees, setEmployees] = React.useState<PlanEmployee[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [kindTab, setKindTab] = React.useState<string>('monthly');

  const [editor, setEditor] = React.useState<{ open: boolean; plan: PlanItem | null }>({ open: false, plan: null });
  const [form, setForm] = React.useState<PlanForm>({ scope: 'personal', user_id: '', period_kind: 'monthly', period_date: today, target_count: '', note: '' });
  const [isSaving, setIsSaving] = React.useState(false);
  const [planToDelete, setPlanToDelete] = React.useState<PlanItem | null>(null);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.goals.getAll();
      setItems(res.items);
      setEmployees(res.employees);
    } catch (err: any) {
      showToast(err.message || 'Не удалось загрузить планы', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setForm({ scope: 'personal', user_id: '', period_kind: (kindTab === 'all' ? 'monthly' : kindTab) as PlanPeriodKind, period_date: today, target_count: '', note: '' });
    setEditor({ open: true, plan: null });
  };

  const openEdit = (plan: PlanItem) => {
    setForm({
      scope: plan.scope,
      user_id: plan.user_id || '',
      period_kind: plan.period_kind,
      period_date: plan.period_start,
      target_count: String(plan.target_count),
      note: plan.note || '',
    });
    setEditor({ open: true, plan });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(form.target_count, 10);
    if (!Number.isFinite(target) || target < 1) {
      showToast('Укажите план: целое число больше нуля', 'error');
      return;
    }
    if (form.scope === 'personal' && !form.user_id) {
      showToast('Выберите сотрудника для персонального плана', 'error');
      return;
    }
    setIsSaving(true);
    try {
      if (editor.plan) {
        const updated = await api.goals.update(editor.plan.plan_id, { target_count: target, note: form.note.trim() || null });
        setItems((prev) => prev.map((p) => (p.plan_id === updated.plan_id ? updated : p)));
        showToast('План обновлен', 'success');
      } else {
        const created = await api.goals.create({
          scope: form.scope,
          user_id: form.scope === 'team' ? null : form.user_id,
          period_kind: form.period_kind,
          period_date: form.period_date,
          target_count: target,
          note: form.note.trim() || null,
        });
        setItems((prev) => [created, ...prev.filter((p) => p.plan_id !== created.plan_id)]);
        showToast(created.replaced ? 'План на этот период обновлен' : 'План поставлен', 'success');
        setKindTab(form.period_kind);
      }
      setEditor({ open: false, plan: null });
    } catch (err: any) {
      showToast(err.message || 'Не удалось сохранить план', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!planToDelete) return;
    try {
      await api.goals.delete(planToDelete.plan_id);
      setItems((prev) => prev.filter((p) => p.plan_id !== planToDelete.plan_id));
      showToast('План удален', 'info');
      setPlanToDelete(null);
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить план', 'error');
    }
  };

  const countsByKind = React.useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const p of items) c[p.period_kind] = (c[p.period_kind] || 0) + 1;
    return c;
  }, [items]);

  const tabs: DataJournalTab[] = [
    ...PLAN_PERIOD_KINDS.map((k) => ({ id: k, label: PLAN_PERIOD_LABELS[k], count: countsByKind[k] || 0 })),
    { id: 'all', label: 'Все', count: items.length },
  ];

  const visible = React.useMemo(() => (kindTab === 'all' ? items : items.filter((p) => p.period_kind === kindTab)), [items, kindTab]);

  // Сводка: текущие периоды (сегодня внутри периода)
  const current = React.useMemo(() => items.filter((p) => p.period_start <= today && today < p.period_end), [items, today]);
  const summary = React.useMemo(() => {
    const team = current.filter((p) => p.scope === 'team');
    const personal = current.filter((p) => p.scope === 'personal');
    return {
      active: current.length,
      done: current.filter((p) => p.progress_status === 'done').length,
      teamMonthly: team.find((p) => p.period_kind === 'monthly') || team[0] || null,
      personalTotal: personal.reduce((s, p) => s + p.target_count, 0),
      personalActual: personal.reduce((s, p) => s + p.actual_count, 0),
      behind: current.filter((p) => p.progress_status === 'active' && p.actual_count / p.target_count < p.elapsed_share).length,
    };
  }, [current]);

  const columns: ColumnDef<PlanItem>[] = React.useMemo(
    () => [
      {
        key: 'user_id',
        label: 'План для',
        width: 220,
        minWidth: 170,
        sortable: true,
        filterable: true,
        cardTitle: true,
        textValue: (row) => (row.scope === 'team' ? 'Общий план' : row.user?.full_name || ''),
        renderCell: (row) =>
          row.scope === 'team' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
              <Users className="w-3.5 h-3.5" strokeWidth={2} />
              Общий план
            </span>
          ) : row.user ? (
            <EmployeeBadge name={row.user.full_name} color={row.user.color} size="sm" />
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          ),
      },
      {
        key: 'period_kind',
        label: 'Вид',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        filterType: 'select',
        filterOptions: PLAN_PERIOD_KINDS.map((k) => ({ value: k, label: PLAN_PERIOD_LABELS[k] })),
        renderCell: (row) => <span className="text-xs text-zinc-700 dark:text-zinc-300">{PLAN_PERIOD_LABELS[row.period_kind]}</span>,
      },
      {
        key: 'period_start',
        label: 'Период',
        width: 170,
        minWidth: 140,
        sortable: true,
        filterable: true,
        textValue: (row) => formatPeriodLabel(row.period_kind, row.period_start),
        renderCell: (row) => (
          <span className={`text-xs font-mono font-semibold ${row.period_start <= today && today < row.period_end ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
            {formatPeriodLabel(row.period_kind, row.period_start)}
          </span>
        ),
      },
      {
        key: 'actual_count',
        label: 'Выполнение',
        width: 220,
        minWidth: 180,
        sortable: true,
        filterable: false,
        renderCell: (row) => <ProgressBar item={row} />,
      },
      {
        key: 'progress_status',
        label: 'Статус',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        filterType: 'select',
        filterOptions: (Object.keys(PLAN_STATUS_LABELS) as PlanItem['progress_status'][]).map((s) => ({ value: s, label: PLAN_STATUS_LABELS[s] })),
        renderCell: (row) => (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_CLASS[row.progress_status]}`}>
            {PLAN_STATUS_LABELS[row.progress_status]}
          </span>
        ),
      },
      {
        key: 'remaining',
        label: 'Осталось',
        type: 'number',
        width: 110,
        minWidth: 90,
        sortable: true,
        filterable: false,
        renderCell: (row) => <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300">{row.remaining}</span>,
      },
      {
        key: 'note',
        label: 'Примечание',
        width: 220,
        minWidth: 150,
        sortable: false,
        filterable: true,
        renderCell: (row) => <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate block">{row.note || '—'}</span>,
      },
      ...(isAdmin
        ? [
            {
              key: 'actions',
              label: 'Действия',
              width: 150,
              minWidth: 130,
              sortable: false,
              filterable: false,
              renderCell: (row: PlanItem) => (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="xs" onClick={() => openEdit(row)} leftIcon={<Pencil className="w-3.5 h-3.5" />}>
                    Цель
                  </Button>
                  <Button variant="ghost" size="xs" className="text-rose-600 dark:text-rose-400" onClick={() => setPlanToDelete(row)} leftIcon={<Trash2 className="w-3.5 h-3.5" />} />
                </div>
              ),
            } as ColumnDef<PlanItem>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, today]
  );

  const normalizedStart = normalizePeriodStart(form.period_kind, form.period_date || today);

  return (
    <AppLayout
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по сотрудникам и периодам..."
      onCreateClick={isAdmin ? openCreate : undefined}
      createTooltip="Поставить план"
      hideFab={!isAdmin}
    >
      <div className="space-y-6 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Target className="w-4 h-4" strokeWidth={2} />
              <span>Планы по подключениям</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight mt-1">Планы</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Факт — подтвержденные подключения за период. Персональные планы по каждому сотруднику и общий план команды.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button variant="outline" size="lg" onClick={fetchData} loading={isLoading} leftIcon={<RotateCcw className="w-4 h-4" strokeWidth={1.75} />}>
              Обновить
            </Button>
            {isAdmin && (
              <Button size="lg" onClick={openCreate} leftIcon={<Plus className="w-4 h-4" strokeWidth={2} />}>
                Поставить план
              </Button>
            )}
          </div>
        </div>

        <CollapsibleStats storageKey="goals">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1 col-span-2 lg:col-span-1">
              <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Общий план {summary.teamMonthly ? `(${formatPeriodLabel(summary.teamMonthly.period_kind, summary.teamMonthly.period_start)})` : ''}
              </span>
              {summary.teamMonthly ? (
                <ProgressBar item={summary.teamMonthly} />
              ) : (
                <p className="text-xs text-zinc-400">{isAdmin ? 'Общий план на текущий период не поставлен' : 'Не поставлен'}</p>
              )}
            </div>
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Персональные (текущие)
              </span>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 font-mono">
                {summary.personalActual}
                <span className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium"> / {summary.personalTotal}</span>
              </p>
            </div>
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Выполнено
              </span>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                {summary.done}
                <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-medium"> из {summary.active}</span>
              </p>
            </div>
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Отстают от графика
              </span>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 font-mono">{summary.behind}</p>
            </div>
          </div>
        </CollapsibleStats>

        <DataJournal<PlanItem>
          data={visible}
          columns={columns}
          keyField="plan_id"
          title="Реестр планов"
          storageKey="goals_journal"
          emptyMessage={isAdmin ? 'Планы не поставлены — нажмите «Поставить план»' : 'Планы на этот вид периода не поставлены'}
          externalSearchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tabs={tabs}
          activeTab={kindTab}
          onTabChange={setKindTab}
          totalCount={visible.length}
          onRowClick={isAdmin ? openEdit : undefined}
          onCreateClick={isAdmin ? openCreate : undefined}
          createTooltip="Поставить план"
        />

        <Modal
          open={editor.open}
          onClose={() => setEditor({ open: false, plan: null })}
          title={editor.plan ? 'Изменить план' : 'Поставить план'}
          subtitle={editor.plan ? `${editor.plan.scope === 'team' ? 'Общий план' : editor.plan.user?.full_name || ''} • ${formatPeriodLabel(editor.plan.period_kind, editor.plan.period_start)}` : 'Количество подтвержденных подключений за период'}
          icon={Target}
          tone="info"
          size="lg"
          busy={isSaving}
          formId={FORM_ID}
          onSubmit={handleSave}
          footer={
            <>
              <Button variant="outline" onClick={() => setEditor({ open: false, plan: null })} disabled={isSaving}>
                Отмена
              </Button>
              <Button type="submit" form={FORM_ID} variant="info" loading={isSaving}>
                {editor.plan ? 'Сохранить' : 'Поставить план'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {!editor.plan && (
              <>
                <FormField label="Тип плана">
                  <div className="grid grid-cols-2 gap-2">
                    {(['personal', 'team'] as PlanScope[]).map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, scope, user_id: scope === 'team' ? '' : f.user_id }))}
                        className={`h-10 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          form.scope === scope ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500'
                        }`}
                      >
                        {scope === 'team' ? <Users className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                        {PLAN_SCOPE_LABELS[scope]}
                      </button>
                    ))}
                  </div>
                </FormField>
                {form.scope === 'personal' && (
                  <FormField label="Сотрудник" required htmlFor="plan-user">
                    <Select id="plan-user" value={form.user_id} onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))} size="lg" required>
                      <option value="">— Выберите сотрудника —</option>
                      {employees.map((emp) => (
                        <option key={emp.user_id} value={emp.user_id}>
                          {emp.full_name} (@{emp.login})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label="Вид плана" htmlFor="plan-kind">
                    <Select id="plan-kind" value={form.period_kind} onChange={(e) => setForm((f) => ({ ...f, period_kind: e.target.value as PlanPeriodKind }))} size="lg">
                      {PLAN_PERIOD_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {PLAN_PERIOD_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Дата внутри периода" htmlFor="plan-date" hint={`Период: ${formatPeriodLabel(form.period_kind, normalizedStart)}`}>
                    <Input id="plan-date" type="date" value={form.period_date} onChange={(e) => setForm((f) => ({ ...f, period_date: e.target.value }))} mono size="lg" required />
                  </FormField>
                </div>
              </>
            )}
            <FormField label="План подключений" required htmlFor="plan-target">
              <Input id="plan-target" type="number" min={1} step={1} value={form.target_count} onChange={(e) => setForm((f) => ({ ...f, target_count: e.target.value }))} placeholder="Например: 10" mono size="lg" required autoFocus />
            </FormField>
            <FormField label="Примечание" htmlFor="plan-note">
              <Textarea id="plan-note" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Комментарий к плану (необязательно)" />
            </FormField>
            {!editor.plan && (
              <ModalCallout tone="info">
                Если план на этот период уже есть, цель будет обновлена. Факт считается по подтвержденным подключениям с датой назначения консультанта внутри периода.
              </ModalCallout>
            )}
          </div>
        </Modal>

        <ConfirmDialog
          open={planToDelete !== null}
          onClose={() => setPlanToDelete(null)}
          onConfirm={handleDelete}
          title="Удалить план?"
          subtitle={planToDelete ? `${planToDelete.scope === 'team' ? 'Общий план' : planToDelete.user?.full_name || ''} • ${formatPeriodLabel(planToDelete.period_kind, planToDelete.period_start)}` : undefined}
          description="План будет удален. Подключения и начисления не затрагиваются."
          tone="danger"
          confirmLabel="Удалить"
          level={2}
        />
      </div>
    </AppLayout>
  );
}

