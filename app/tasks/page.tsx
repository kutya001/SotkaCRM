'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CollapsibleStats } from '@/components/ui/CollapsibleStats';
import { DataJournal, type ColumnDef, type DataJournalTab, type StatusOption } from '@/components/ui/DataJournal';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select, Textarea, ReadOnlyValue } from '@/components/ui/Field';
import { useUser } from '@/components/auth/AuthProvider';
import { api, type TaskItem, type TaskUserRef } from '@/lib/api/client';
import { formatDateOnly, formatDateTime, todayISODate } from '@/lib/utils/format';
import {
  TASK_PRIORITY_LABELS,
  allowedTaskTransitions,
  canAssignTask,
  canEditTaskFields,
  canManageTasks,
  canDeleteTask,
  isOpenTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/rules';
import {
  ListTodo,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
  Trash2,
  Pencil,
  Flag,
  RotateCcw,
} from 'lucide-react';

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'Открыт', label: 'Открыт', colorClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', dotColor: 'bg-blue-500' },
  { value: 'Назначен', label: 'Назначен', colorClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', dotColor: 'bg-amber-500' },
  { value: 'Выполнен', label: 'Выполнен', colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', dotColor: 'bg-emerald-500' },
  { value: 'Отложен', label: 'Отложен', colorClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30', dotColor: 'bg-purple-500' },
  { value: 'Отмена', label: 'Отмена', colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30', dotColor: 'bg-rose-500' },
];

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700',
  normal: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
  high: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
};

const FORM_ID = 'task-form';

interface TaskForm {
  title: string;
  description: string;
  assigned_to: string;
  due_date: string;
  priority: TaskPriority;
}

const EMPTY_FORM: TaskForm = { title: '', description: '', assigned_to: '', due_date: '', priority: 'normal' };

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PRIORITY_CLASS[priority]}`}>
      <Flag className="w-3 h-3" strokeWidth={2} />
      {TASK_PRIORITY_LABELS[priority]}
    </span>
  );
}

export default function TasksPage() {
  const { showToast } = useToast();
  const user = useUser();
  const role = user.role;
  const userId = user.profile?.user_id || '';
  const actor = React.useMemo(() => ({ userId, permissions: user.permissions }), [userId, user.permissions]);
  const isManager = canManageTasks(actor);
  const canCreateTask = user.can('tasks.create');
  const today = todayISODate();

  const [tasks, setTasks] = React.useState<TaskItem[]>([]);
  const [employees, setEmployees] = React.useState<TaskUserRef[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [tab, setTab] = React.useState('active');

  const [editor, setEditor] = React.useState<{ open: boolean; task: TaskItem | null }>({ open: false, task: null });
  const [form, setForm] = React.useState<TaskForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = React.useState(false);
  const [viewTask, setViewTask] = React.useState<TaskItem | null>(null);
  const [taskToDelete, setTaskToDelete] = React.useState<TaskItem | null>(null);
  const [statusDialog, setStatusDialog] = React.useState<{ task: TaskItem; status: TaskStatus; note: string; due_date: string } | null>(null);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.tasks.getAll();
      setTasks(res.items);
    } catch (err: any) {
      showToast(err.message || 'Не удалось загрузить задачи', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Сотрудники для назначения: руководство — все активные (из модуля планов), остальные — только себя
  const canAssignOthers = canAssignTask(actor);
  React.useEffect(() => {
    if (!canAssignOthers) {
      if (user.profile) {
        setEmployees([{ user_id: user.profile.user_id, full_name: user.userName, login: user.userLogin, role, color: (user.profile as any).color ?? null }]);
      }
      return;
    }
    api.goals
      .getAll()
      .then((res) => setEmployees(res.employees.map((e) => ({ user_id: e.user_id, full_name: e.full_name, login: e.login, role: e.role, color: e.color }))))
      .catch(() => undefined);
  }, [canAssignOthers, role, user.profile, user.userName, user.userLogin]);


  const openCreate = () => {
    setForm({ ...EMPTY_FORM, assigned_to: canAssignOthers ? '' : userId });
    setEditor({ open: true, task: null });
  };

  const openEdit = (task: TaskItem) => {
    setForm({
      title: task.title,
      description: task.description || '',
      assigned_to: task.assigned_to || '',
      due_date: task.due_date || '',
      priority: task.priority,
    });
    setEditor({ open: true, task });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.title.trim().length < 2) {
      showToast('Введите название задачи', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        assigned_to: form.assigned_to || null,
        due_date: form.due_date || null,
        priority: form.priority,
      };
      if (editor.task) {
        const updated = await api.tasks.update(editor.task.task_id, payload);
        setTasks((prev) => prev.map((t) => (t.task_id === updated.task_id ? updated : t)));
        showToast('Задача обновлена', 'success');
      } else {
        const created = await api.tasks.create(payload);
        setTasks((prev) => [created, ...prev]);
        showToast(created.assigned_to && created.assigned_to !== userId ? 'Задача поставлена, ответственный уведомлен' : 'Задача создана', 'success');
      }
      setEditor({ open: false, task: null });
    } catch (err: any) {
      showToast(err.message || 'Не удалось сохранить задачу', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const applyStatus = async (task: TaskItem, status: TaskStatus, extra: { result_note?: string | null; due_date?: string | null } = {}) => {
    const updated = await api.tasks.update(task.task_id, { status, ...extra });
    setTasks((prev) => prev.map((t) => (t.task_id === updated.task_id ? updated : t)));
    setViewTask((prev) => (prev && prev.task_id === updated.task_id ? updated : prev));
    showToast(`Статус: ${status}`, 'success');
  };

  const handleStatusChange = React.useCallback(
    async (task: TaskItem, status: string): Promise<void | boolean> => {
      if (status === 'Отложен' || status === 'Отмена') {
        setStatusDialog({ task, status: status as TaskStatus, note: task.result_note || '', due_date: task.due_date || '' });
        return false;
      }
      await applyStatus(task, status as TaskStatus);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const getStatusOptions = React.useCallback(
    (task: TaskItem) => {
      const allowed = allowedTaskTransitions(actor, task);
      if (allowed.length === 0) return null;
      return STATUS_OPTIONS.filter((o) => o.value === task.status || allowed.includes(o.value as TaskStatus));
    },
    [actor]
  );

  const handleDelete = async () => {
    if (!taskToDelete) return;
    try {
      await api.tasks.delete(taskToDelete.task_id);
      setTasks((prev) => prev.filter((t) => t.task_id !== taskToDelete.task_id));
      setViewTask(null);
      showToast('Задача удалена', 'info');
      setTaskToDelete(null);
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить задачу', 'error');
    }
  };

  const counts = React.useMemo(() => {
    const c = { active: 0, mine: 0, overdue: 0, done: 0, postponed: 0, cancelled: 0 };
    for (const t of tasks) {
      if (isOpenTaskStatus(t.status)) c.active++;
      if (t.assigned_to === userId && isOpenTaskStatus(t.status)) c.mine++;
      if (t.is_overdue) c.overdue++;
      if (t.status === 'Выполнен') c.done++;
      if (t.status === 'Отложен') c.postponed++;
      if (t.status === 'Отмена') c.cancelled++;
    }
    return c;
  }, [tasks, userId]);

  const tabs: DataJournalTab[] = [
    { id: 'active', label: 'В работе', count: counts.active, icon: Clock },
    { id: 'mine', label: 'Мои', count: counts.mine },
    { id: 'overdue', label: 'Просрочено', count: counts.overdue, icon: AlertTriangle, color: 'rose' },
    { id: 'done', label: 'Выполнено', count: counts.done, icon: CheckCircle2 },
    { id: 'postponed', label: 'Отложено', count: counts.postponed, icon: PauseCircle },
    { id: 'cancelled', label: 'Отмена', count: counts.cancelled, icon: XCircle },
    { id: 'all', label: 'Все', count: tasks.length },
  ];

  const visible = React.useMemo(() => {
    switch (tab) {
      case 'active':
        return tasks.filter((t) => isOpenTaskStatus(t.status));
      case 'mine':
        return tasks.filter((t) => t.assigned_to === userId && isOpenTaskStatus(t.status));
      case 'overdue':
        return tasks.filter((t) => t.is_overdue);
      case 'done':
        return tasks.filter((t) => t.status === 'Выполнен');
      case 'postponed':
        return tasks.filter((t) => t.status === 'Отложен');
      case 'cancelled':
        return tasks.filter((t) => t.status === 'Отмена');
      default:
        return tasks;
    }
  }, [tasks, tab, userId]);

  const columns: ColumnDef<TaskItem>[] = React.useMemo(
    () => [
      {
        key: 'title',
        label: 'Задача',
        width: 320,
        minWidth: 200,
        sortable: true,
        filterable: true,
        cardTitle: true,
        renderCell: (row) => (
          <div className="min-w-0">
            <div className={`text-xs font-semibold truncate ${row.status === 'Выполнен' || row.status === 'Отмена' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'}`}>
              {row.title}
            </div>
            {row.description && <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{row.description.split('\n')[0]}</div>}
          </div>
        ),
      },
      {
        key: 'status',
        label: 'Статус',
        type: 'status',
        statusOptions: STATUS_OPTIONS,
        width: 150,
        minWidth: 130,
        sortable: true,
        filterable: true,
        filterType: 'select',
      },
      {
        key: 'assigned_to',
        label: 'Ответственный',
        width: 190,
        minWidth: 150,
        sortable: true,
        filterable: true,
        textValue: (row) => row.assigned_user?.full_name || 'Не назначен',
        renderCell: (row) =>
          row.assigned_user ? (
            <EmployeeBadge name={row.assigned_user.full_name} color={row.assigned_user.color} size="sm" />
          ) : (
            <span className="text-xs text-zinc-400 italic">Не назначен</span>
          ),
      },
      {
        key: 'due_date',
        label: 'Срок',
        type: 'date',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        filterType: 'dateRange',
        renderCell: (row) =>
          row.due_date ? (
            <span
              className={`inline-flex items-center gap-1 text-xs font-mono ${
                row.is_overdue ? 'text-rose-600 dark:text-rose-400 font-bold' : row.due_date === today && isOpenTaskStatus(row.status) ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {row.is_overdue && <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />}
              {formatDateOnly(row.due_date)}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          ),
      },
      {
        key: 'priority',
        label: 'Приоритет',
        width: 130,
        minWidth: 110,
        sortable: true,
        filterable: true,
        filterType: 'select',
        filterOptions: (Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] })),
        renderCell: (row) => <PriorityBadge priority={row.priority} />,
      },
      {
        key: 'created_by',
        label: 'Поставил',
        width: 170,
        minWidth: 140,
        sortable: true,
        filterable: true,
        textValue: (row) => row.creator?.full_name || '',
        renderCell: (row) => (row.creator ? <EmployeeBadge name={row.creator.full_name} color={row.creator.color} size="sm" /> : '—'),
      },
      { key: 'created_at', label: 'Создана', type: 'datetime', width: 170, minWidth: 150, sortable: true, filterable: false },
      { key: 'completed_at', label: 'Выполнена', type: 'datetime', width: 170, minWidth: 150, sortable: true, filterable: false },
    ],
    [today]
  );

  const canEditCurrent = (task: TaskItem) => canEditTaskFields(actor, task);
  const canDeleteCurrent = (task: TaskItem) => canDeleteTask(actor, task);

  return (
    <AppLayout
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по задачам, ответственным..."
      onCreateClick={openCreate}
      createTooltip="Новая задача"
    >
      <div className="space-y-6 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <ListTodo className="w-4 h-4" strokeWidth={2} />
              <span>Поручения и контроль сроков</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight mt-1">Задачи</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {isManager ? 'Ставьте задачи сотрудникам: ответственный получит уведомление в Telegram' : 'Ваши задачи и задачи, которые вы поставили себе'}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button variant="outline" size="lg" onClick={fetchData} loading={isLoading} leftIcon={<RotateCcw className="w-4 h-4" strokeWidth={1.75} />}>
              Обновить
            </Button>
            <Button size="lg" onClick={openCreate} leftIcon={<Plus className="w-4 h-4" strokeWidth={2} />}>
              Новая задача
            </Button>
          </div>
        </div>

        <CollapsibleStats storageKey="tasks">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
              <span className="text-[11px] text-zinc-400 font-medium">В работе</span>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">{counts.active}</p>
            </div>
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">Мои</span>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 font-mono">{counts.mine}</p>
            </div>
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">Просрочено</span>
              <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 font-mono">{counts.overdue}</p>
            </div>
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Выполнено</span>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">{counts.done}</p>
            </div>
          </div>
        </CollapsibleStats>

        <DataJournal<TaskItem>
          data={visible}
          columns={columns}
          keyField="task_id"
          title="Реестр задач"
          storageKey="tasks_journal"
          emptyMessage="Задач пока нет"
          externalSearchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tabs={tabs}
          activeTab={tab}
          onTabChange={setTab}
          totalCount={visible.length}
          onRowClick={(row) => setViewTask(row)}
          onStatusChange={handleStatusChange}
          getStatusOptions={getStatusOptions}
          onCreateClick={openCreate}
          createTooltip="Новая задача"
        />

        {/* Карточка задачи */}
        {viewTask && (
          <Modal
            open
            onClose={() => setViewTask(null)}
            title={viewTask.title}
            subtitle={`Поставил: ${viewTask.creator?.full_name || '—'} • ${formatDateTime(viewTask.created_at)}`}
            icon={ListTodo}
            tone={viewTask.is_overdue ? 'danger' : 'warning'}
            size="lg"
            footerClassName="justify-between"
            footer={
              <>
                <div className="flex items-center gap-2">
                  {canDeleteCurrent(viewTask) && (
                    <Button variant="dangerSoft" onClick={() => setTaskToDelete(viewTask)} leftIcon={<Trash2 className="w-3.5 h-3.5" />}>
                      Удалить
                    </Button>
                  )}
                  {canEditCurrent(viewTask) && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        openEdit(viewTask);
                        setViewTask(null);
                      }}
                      leftIcon={<Pencil className="w-3.5 h-3.5" />}
                    >
                      Изменить
                    </Button>
                  )}
                </div>
                <Button variant="outline" onClick={() => setViewTask(null)}>
                  Закрыть
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              {viewTask.is_overdue && (
                <ModalCallout tone="danger">
                  Срок истек {formatDateOnly(viewTask.due_date)} — задача просрочена.
                </ModalCallout>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <FormField label="Статус">
                  <ReadOnlyValue>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_OPTIONS.find((o) => o.value === viewTask.status)?.colorClass || ''}`}>
                      {viewTask.status}
                    </span>
                  </ReadOnlyValue>
                </FormField>
                <FormField label="Приоритет">
                  <ReadOnlyValue>
                    <PriorityBadge priority={viewTask.priority} />
                  </ReadOnlyValue>
                </FormField>
                <FormField label="Ответственный">
                  <ReadOnlyValue>
                    {viewTask.assigned_user ? <EmployeeBadge name={viewTask.assigned_user.full_name} color={viewTask.assigned_user.color} size="sm" /> : 'Не назначен'}
                  </ReadOnlyValue>
                </FormField>
                <FormField label="Срок">
                  <ReadOnlyValue mono>{viewTask.due_date ? formatDateOnly(viewTask.due_date) : '—'}</ReadOnlyValue>
                </FormField>
                {viewTask.completed_at && (
                  <FormField label="Выполнена">
                    <ReadOnlyValue mono>{formatDateTime(viewTask.completed_at)}</ReadOnlyValue>
                  </FormField>
                )}
              </div>
              {viewTask.description && (
                <FormField label="Описание">
                  <ReadOnlyValue className="whitespace-pre-wrap leading-relaxed">{viewTask.description}</ReadOnlyValue>
                </FormField>
              )}
              {viewTask.result_note && (
                <FormField label="Комментарий">
                  <ReadOnlyValue className="whitespace-pre-wrap leading-relaxed">{viewTask.result_note}</ReadOnlyValue>
                </FormField>
              )}

              {/* Быстрая смена статуса */}
              {(() => {
                const allowed = allowedTaskTransitions(actor, viewTask);
                if (allowed.length === 0) return null;
                return (
                  <FormField label="Перевести в статус">
                    <div className="flex flex-wrap gap-2">
                      {allowed.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === 'Выполнен' ? 'success' : s === 'Отмена' ? 'dangerSoft' : 'secondary'}
                          onClick={() => handleStatusChange(viewTask, s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  </FormField>
                );
              })()}
            </div>
          </Modal>
        )}

        {/* Создание / редактирование */}
        <Modal
          open={editor.open}
          onClose={() => setEditor({ open: false, task: null })}
          title={editor.task ? 'Редактирование задачи' : 'Новая задача'}
          subtitle={editor.task ? editor.task.title : 'Ответственный получит уведомление в Telegram'}
          icon={editor.task ? Pencil : Plus}
          tone="warning"
          size="lg"
          busy={isSaving}
          formId={FORM_ID}
          onSubmit={handleSave}
          footer={
            <>
              <Button variant="outline" onClick={() => setEditor({ open: false, task: null })} disabled={isSaving}>
                Отмена
              </Button>
              <Button type="submit" form={FORM_ID} loading={isSaving}>
                {editor.task ? 'Сохранить' : 'Поставить задачу'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Название" required htmlFor="task-title">
              <Input id="task-title" required minLength={2} maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Например: Перезвонить клиенту по тарифу" size="lg" autoFocus />
            </FormField>
            <FormField label="Описание" htmlFor="task-description">
              <Textarea id="task-description" rows={4} maxLength={5000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Что нужно сделать, детали, ссылки..." />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="Ответственный"
                htmlFor="task-assignee"
                hint={canAssignTask(actor) ? 'Смена ответственного отправит уведомление' : 'Назначать задачи другим может сотрудник с правом назначения'}
              >
                <Select
                  id="task-assignee"
                  value={form.assigned_to}
                  onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
                  disabled={!canAssignTask(actor)}
                  size="lg"
                >
                  <option value="">— Не назначен —</option>
                  {employees.map((emp) => (
                    <option key={emp.user_id} value={emp.user_id}>
                      {emp.full_name} (@{emp.login})
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Срок" htmlFor="task-due">
                <Input id="task-due" type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} mono size="lg" />
              </FormField>
            </div>
            <FormField label="Приоритет" htmlFor="task-priority">
              <Select id="task-priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))} size="lg">
                {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </Modal>

        {/* Отложить / отменить с комментарием */}
        <ConfirmDialog
          open={statusDialog !== null}
          onClose={() => setStatusDialog(null)}
          onConfirm={async () => {
            if (!statusDialog) return;
            try {
              await applyStatus(statusDialog.task, statusDialog.status, {
                result_note: statusDialog.note.trim() || null,
                ...(statusDialog.status === 'Отложен' && statusDialog.due_date ? { due_date: statusDialog.due_date } : {}),
              });
              setStatusDialog(null);
            } catch (err: any) {
              showToast(err.message || 'Не удалось изменить статус', 'error');
            }
          }}
          title={statusDialog?.status === 'Отложен' ? 'Отложить задачу' : 'Отменить задачу'}
          subtitle={statusDialog?.task.title}
          tone={statusDialog?.status === 'Отложен' ? 'warning' : 'danger'}
          icon={statusDialog?.status === 'Отложен' ? PauseCircle : XCircle}
          confirmLabel={statusDialog?.status === 'Отложен' ? 'Отложить' : 'Отменить задачу'}
          level={2}
        >
          {statusDialog?.status === 'Отложен' && (
            <FormField label="Новый срок" htmlFor="task-postpone-date" hint="Оставьте пустым, чтобы снять срок">
              <Input
                id="task-postpone-date"
                type="date"
                mono
                value={statusDialog.due_date}
                onChange={(e) => setStatusDialog((d) => (d ? { ...d, due_date: e.target.value } : d))}
              />
            </FormField>
          )}
          <FormField label="Комментарий" htmlFor="task-status-note">
            <Textarea
              id="task-status-note"
              rows={3}
              maxLength={2000}
              value={statusDialog?.note || ''}
              onChange={(e) => setStatusDialog((d) => (d ? { ...d, note: e.target.value } : d))}
              placeholder={statusDialog?.status === 'Отложен' ? 'Почему откладываем и до когда' : 'Причина отмены'}
            />
          </FormField>
        </ConfirmDialog>

        <ConfirmDialog
          open={taskToDelete !== null}
          onClose={() => setTaskToDelete(null)}
          onConfirm={handleDelete}
          title="Удалить задачу?"
          subtitle={taskToDelete?.title}
          description="Задача будет удалена безвозвратно."
          tone="danger"
          confirmLabel="Удалить"
          level={2}
        />
      </div>
    </AppLayout>
  );
}

