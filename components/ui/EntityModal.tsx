'use client';

import * as React from 'react';
import {
  Pencil,
  Save,
  Copy,
  Check,
  Phone,
  MessageCircle,
  Link2,
  Lock,
  Loader2,
  RotateCcw,
  Trash2,
  FileText,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { PIPELINE_STATUS_OPTIONS, type StatusOption } from './DataJournal';
import { Modal } from './Modal';
import { Button, ButtonLink } from './Button';
import { FormField, Input, Select, Textarea, ReadOnlyValue } from './Field';
import { PhoneInput } from './PhoneInput';
import { formatDate, formatDateTime, formatDateOnly, formatMonth } from '@/lib/utils/format';
import { DEFAULT_COUNTRY_CODE, formatPhoneDisplay, telHref, waHref } from '@/lib/utils/phone';
import { cn } from '@/lib/utils/cn';

export type EntityModalMode = 'view' | 'edit' | 'create';

export type EntityFieldType =
  | 'text'
  | 'number'
  /** Отметка времени → «ДД.ММ.ГГГГ» */
  | 'date'
  /** Отметка времени → «ДД.ММ.ГГГГ - чч:мм:сс» */
  | 'datetime'
  /** Значение DATE «ГГГГ-ММ-ДД» → «ДД.ММ.ГГГГ» без сдвига пояса */
  | 'dateOnly'
  /** «ГГГГ-ММ» → «ММ.ГГГГ» */
  | 'month'
  | 'select'
  | 'status'
  | 'phone'
  | 'textarea'
  | 'currency';

export interface EntityFieldConfig<T> {
  name: keyof T | string;
  label: string;
  type?: EntityFieldType;
  placeholder?: string;
  /** Только чтение, клик копирует значение (ID, даты, внешние данные) */
  immutable?: boolean;
  /** Скрыто в режиме создания */
  isSystem?: boolean;
  /** Скрыть поле (например, причину отмены — пока лид не отменен) */
  hidden?: boolean | ((data: Partial<T>, mode: EntityModalMode) => boolean);
  required?: boolean;
  disabled?: boolean;
  defaultValue?: any;
  options?: { value: string; label: string }[];
  helperText?: string;
  /** Ключ кода страны для type="phone" (по умолчанию country_code) */
  countryCodeKey?: string;
  /** Растянуть на всю ширину сетки */
  fullWidth?: boolean;
  renderCustomView?: (val: any, data: T) => React.ReactNode;
}

export interface EntityModalProps<T extends Record<string, any>> {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: EntityModalMode;
  title?: string;
  subtitle?: string;
  data: T | null;
  fields: EntityFieldConfig<T>[];
  keyField?: keyof T;
  phoneField?: keyof T;
  statusField?: keyof T;
  /** Полный справочник статусов (цвета и подписи) */
  statusOptions?: StatusOption[];
  /**
   * Статусы, в которые можно перевести запись из быстрой панели.
   * undefined — все из statusOptions; [] — быстрая смена недоступна (только бейдж).
   */
  allowedStatusValues?: string[] | null;
  onSave?: (updatedData: T) => Promise<void> | void;
  onCreate?: (newData: Partial<T>) => Promise<void> | void;
  /**
   * Быстрая смена статуса. Возврат false — смена не выполнена (например, открыт диалог
   * причины отмены): без тоста и без локального обновления.
   */
  onStatusChange?: (newStatus: string) => Promise<void | boolean> | void | boolean;
  onLinkSeller?: (data: T) => void;
  onDelete?: (data: T) => void;
  deleteLabel?: string;
  createSubmitLabel?: string;
  linkedBanner?: {
    title: string;
    description?: string;
    onNavigate?: () => void;
    navigateLabel?: string;
    onUnlink?: () => void;
    unlinkLabel?: string;
    isUnlinking?: boolean;
  };
  tabs?: { id: string; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  renderTabContent?: (tabId: string) => React.ReactNode;
}

const FORM_ID = 'entity-modal-form';

function formatFieldValue(type: EntityFieldType | undefined, val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  switch (type) {
    case 'date':
      return formatDate(val as string);
    case 'datetime':
      return formatDateTime(val as string);
    case 'dateOnly':
      return formatDateOnly(val as string);
    case 'month':
      return formatMonth(val as string);
    case 'currency':
      return `${Number(val || 0).toLocaleString('ru-RU')} сом`;
    default:
      if (typeof val === 'boolean') return val ? 'Да' : 'Нет';
      if (Array.isArray(val)) return val.length ? val.join(', ') : '—';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
  }
}

export function EntityModal<T extends Record<string, any>>({
  isOpen,
  onClose,
  initialMode = 'view',
  title,
  subtitle,
  data,
  fields,
  keyField = 'id' as keyof T,
  phoneField = 'phone' as keyof T,
  statusField = 'status' as keyof T,
  statusOptions = PIPELINE_STATUS_OPTIONS,
  allowedStatusValues,
  onSave,
  onCreate,
  onStatusChange,
  onLinkSeller,
  onDelete,
  deleteLabel = 'Удалить навсегда',
  createSubmitLabel = 'Сохранить запись',
  linkedBanner,
  tabs,
  activeTab = 'main',
  onTabChange,
  renderTabContent,
}: EntityModalProps<T>) {
  const { showToast } = useToast();

  const [mode, setMode] = React.useState<EntityModalMode>(initialMode);
  const [formData, setFormData] = React.useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copiedFieldName, setCopiedFieldName] = React.useState<string | null>(null);

  // Синхронизация режима и данных при открытии
  React.useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    if (initialMode === 'create') {
      const initialForm: Record<string, any> = {};
      fields.forEach((f) => {
        if (f.isSystem) return;
        if (f.defaultValue !== undefined) {
          initialForm[String(f.name)] = f.defaultValue;
        } else if (f.type === 'status') {
          initialForm[String(f.name)] = statusOptions[0]?.value || 'Открыт';
        } else if (f.type === 'phone') {
          initialForm[String(f.name)] = '';
          initialForm[f.countryCodeKey || 'country_code'] = DEFAULT_COUNTRY_CODE;
        } else {
          initialForm[String(f.name)] = '';
        }
      });
      if (data) {
        Object.entries(data).forEach(([k, v]) => {
          if (v !== undefined && v !== null) initialForm[k] = v;
        });
      }
      setFormData(initialForm);
    } else if (data) {
      setFormData({ ...data });
    }
  }, [isOpen, initialMode, data, fields, statusOptions]);

  if (!isOpen) return null;

  const handleCopyImmutable = (value: string, fieldKey: string) => {
    if (!value || value === '—') return;
    navigator.clipboard?.writeText(value);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    setCopiedFieldName(fieldKey);
    showToast('Скопировано в буфер', 'success');
    setTimeout(() => setCopiedFieldName(null), 1500);
  };

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  // Быстрая смена статуса из панели действий
  const handleQuickStatusChange = async (newStatus: string) => {
    if (!onStatusChange) return;
    setIsSubmitting(true);
    try {
      const result = await onStatusChange(newStatus);
      if (result === false) return;
      setFormData((prev) => ({ ...prev, [String(statusField)]: newStatus }));
      showToast(`Статус обновлен: ${newStatus}`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Ошибка при обновлении статуса', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (mode === 'edit' && onSave) {
        await onSave(formData as T);
        showToast('Изменения успешно сохранены', 'success');
        setMode('view');
      } else if (mode === 'create' && onCreate) {
        await onCreate(formData as Partial<T>);
        showToast('Запись успешно создана', 'success');
        onClose();
      }
    } catch (err: any) {
      showToast(err?.message || 'Произошла ошибка при сохранении', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    if (mode === 'edit') {
      if (data) setFormData({ ...data });
      setMode('view');
    } else {
      onClose();
    }
  };

  // Данные шапки и ссылок связи
  const currentRecordId = data ? String(data[keyField] ?? '') : '';
  const phoneFieldConfig = fields.find((f) => String(f.name) === String(phoneField));
  const phoneCountryKey = phoneFieldConfig?.countryCodeKey || 'country_code';
  const currentPhone = data ? data[phoneField] : '';
  const currentPhoneCountry = data && data[phoneCountryKey] ? String(data[phoneCountryKey]) : undefined;
  const hasPhone = Boolean(String(currentPhone ?? '').replace(/\D/g, ''));
  const currentStatus = String(formData[String(statusField)] ?? data?.[statusField] ?? '');

  const quickStatusOptions =
    allowedStatusValues === undefined || allowedStatusValues === null
      ? statusOptions
      : statusOptions.filter((o) => o.value === currentStatus || allowedStatusValues.includes(o.value));
  const canQuickChangeStatus =
    Boolean(onStatusChange) && quickStatusOptions.some((o) => o.value !== currentStatus);

  const modalTitle =
    mode === 'create'
      ? `Создание: ${title || 'Новая запись'}`
      : mode === 'edit'
      ? `Редактирование: ${title || 'Запись'}`
      : title || 'Карточка записи';

  const modalSubtitle =
    subtitle || (currentRecordId && mode !== 'create' ? `ID: ${currentRecordId}` : undefined);

  const visibleFields = fields.filter((f) => {
    if (mode === 'create' && f.isSystem) return false;
    if (typeof f.hidden === 'function') return !f.hidden(formData as Partial<T>, mode);
    return !f.hidden;
  });

  const showCustomTab = Boolean(activeTab && activeTab !== 'main' && renderTabContent && mode === 'view');

  // Панель быстрых действий и вкладки (под шапкой в режиме просмотра)
  const headerExtra =
    mode === 'view' && data ? (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {hasPhone && (
              <>
                <ButtonLink href={telHref(currentPhone, currentPhoneCountry)} variant="ghost" size="sm" className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400" leftIcon={<Phone className="w-3.5 h-3.5" strokeWidth={1.75} />} title="Позвонить">
                  Звонок
                </ButtonLink>
                <ButtonLink href={waHref(currentPhone, currentPhoneCountry)} target="_blank" variant="ghost" size="sm" className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" leftIcon={<MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />} title="WhatsApp">
                  WhatsApp
                </ButtonLink>
              </>
            )}
            {onLinkSeller && (
              <Button
                variant="ghost"
                size="sm"
                className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400"
                onClick={() => onLinkSeller(data)}
                leftIcon={<Link2 className="w-3.5 h-3.5" strokeWidth={1.75} />}
              >
                Привязать
              </Button>
            )}
          </div>

          {canQuickChangeStatus && (
            <div className="flex items-center gap-1 overflow-x-auto py-0.5 max-w-full">
              {quickStatusOptions.map((opt) => {
                const isActive = currentStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleQuickStatusChange(opt.value)}
                    disabled={isSubmitting || isActive}
                    className={cn(
                      'h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:cursor-default',
                      isActive
                        ? `${opt.colorClass} ring-2 ring-zinc-400/40 font-bold`
                        : 'bg-white/50 dark:bg-zinc-900/50 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
                    )}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${opt.dotColor || 'bg-current'}`} />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {tabs && tabs.length > 0 && (
          <div className="flex gap-1 overflow-x-auto -mb-4 border-b border-zinc-200/70 dark:border-zinc-800/70">
            {tabs.map((tab) => {
              const isActive = (activeTab || tabs[0].id) === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    'py-2.5 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap',
                    isActive
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  )}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    ) : undefined;

  const footer = (
    <>
      <div className="mr-auto">
        {mode !== 'create' && onDelete && data && (
          <Button variant="dangerSoft" onClick={() => onDelete(data)} leftIcon={<Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />}>
            {deleteLabel}
          </Button>
        )}
      </div>
      {mode === 'view' ? (
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      ) : (
        <>
          <Button variant="outline" onClick={handleCancelEdit} disabled={isSubmitting} leftIcon={mode === 'edit' ? <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} /> : undefined}>
            Отмена
          </Button>
          <Button type="submit" form={FORM_ID} loading={isSubmitting} leftIcon={<Save className="w-3.5 h-3.5" strokeWidth={2} />}>
            {mode === 'edit' ? 'Сохранить' : createSubmitLabel}
          </Button>
        </>
      )}
    </>
  );

  const renderImmutable = (field: EntityFieldConfig<T>, fieldKey: string, val: any) => {
    if (field.renderCustomView) {
      return <ReadOnlyValue>{field.renderCustomView(val, formData as T)}</ReadOnlyValue>;
    }
    const text =
      field.type === 'phone'
        ? formatPhoneDisplay(val, formData[field.countryCodeKey || 'country_code'])
        : field.type === 'select'
        ? field.options?.find((o) => o.value === String(val ?? ''))?.label ?? formatFieldValue(field.type, val)
        : formatFieldValue(field.type, val);
    return (
      <div
        onClick={() => handleCopyImmutable(text, fieldKey)}
        className="group min-h-[36px] flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-xs font-mono text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors"
        title="Нажмите для копирования значения"
      >
        <span className="truncate">{text}</span>
        <span className="pl-2 flex-shrink-0">
          {copiedFieldName === fieldKey ? (
            <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
          ) : (
            <Copy className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 transition-colors" strokeWidth={1.75} />
          )}
        </span>
      </div>
    );
  };

  const renderView = (field: EntityFieldConfig<T>, val: any) => {
    if (field.renderCustomView) return <ReadOnlyValue>{field.renderCustomView(val, formData as T)}</ReadOnlyValue>;
    if (field.type === 'phone') {
      return <ReadOnlyValue mono className="font-semibold">{formatPhoneDisplay(val, formData[field.countryCodeKey || 'country_code'])}</ReadOnlyValue>;
    }
    if (field.type === 'status') {
      const opt = statusOptions.find((o) => o.value === val);
      return (
        <ReadOnlyValue>
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${opt?.colorClass || 'bg-zinc-200 text-zinc-700'}`}>
            {opt?.label || String(val ?? '—')}
          </span>
        </ReadOnlyValue>
      );
    }
    if (field.type === 'select') {
      const label = field.options?.find((o) => o.value === String(val ?? ''))?.label;
      return <ReadOnlyValue>{label ?? formatFieldValue('text', val)}</ReadOnlyValue>;
    }
    if (field.type === 'textarea') {
      return <ReadOnlyValue className="whitespace-pre-wrap items-start">{formatFieldValue('text', val)}</ReadOnlyValue>;
    }
    const mono = field.type === 'date' || field.type === 'datetime' || field.type === 'dateOnly' || field.type === 'month';
    return <ReadOnlyValue mono={mono} className={field.type === 'currency' ? 'font-semibold' : undefined}>{formatFieldValue(field.type, val)}</ReadOnlyValue>;
  };

  const renderEdit = (field: EntityFieldConfig<T>, fieldKey: string, val: any) => {
    if (field.type === 'phone') {
      const codeKey = field.countryCodeKey || 'country_code';
      return (
        <PhoneInput
          id={fieldKey}
          value={{ countryCode: String(formData[codeKey] || DEFAULT_COUNTRY_CODE), national: String(val ?? '') }}
          onChange={(parts) =>
            setFormData((prev) => ({ ...prev, [codeKey]: parts.countryCode, [fieldKey]: parts.national }))
          }
          required={field.required}
          disabled={field.disabled}
          showHint={!field.helperText}
        />
      );
    }
    if (field.type === 'textarea') {
      return (
        <Textarea
          id={fieldKey}
          value={val ?? ''}
          onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
          required={field.required}
          disabled={field.disabled}
          placeholder={field.placeholder || field.label}
        />
      );
    }
    if (field.type === 'status' && mode === 'edit') {
      // Статус меняется только через панель быстрых действий (правила по ролям)
      return renderView(field, val);
    }
    if (field.type === 'select' || field.type === 'status') {
      return (
        <Select
          id={fieldKey}
          value={val ?? ''}
          onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
          required={field.required}
          disabled={field.disabled}
        >
          {(field.options || statusOptions).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {field.type === 'status' && !opt.label.startsWith('●') ? `● ${opt.label}` : opt.label}
            </option>
          ))}
        </Select>
      );
    }
    if (field.type === 'dateOnly') {
      return (
        <Input id={fieldKey} type="date" value={val ?? ''} onChange={(e) => handleFieldChange(fieldKey, e.target.value)} required={field.required} disabled={field.disabled} />
      );
    }
    if (field.type === 'month') {
      return (
        <Input id={fieldKey} type="month" value={val ?? ''} onChange={(e) => handleFieldChange(fieldKey, e.target.value)} required={field.required} disabled={field.disabled} />
      );
    }
    const isNumber = field.type === 'number' || field.type === 'currency';
    return (
      <Input
        id={fieldKey}
        type={isNumber ? 'number' : 'text'}
        value={val ?? ''}
        onChange={(e) => handleFieldChange(fieldKey, isNumber ? Number(e.target.value) : e.target.value)}
        required={field.required}
        disabled={field.disabled}
        placeholder={field.placeholder || field.label}
      />
    );
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={modalTitle}
      subtitle={modalSubtitle}
      icon={FileText}
      tone={mode === 'create' ? 'info' : 'neutral'}
      size="2xl"
      busy={isSubmitting}
      headerRight={
        mode === 'view' && Boolean(onSave) ? (
          <Button variant="secondary" size="sm" onClick={() => setMode('edit')} leftIcon={<Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />} title="Редактировать запись">
            <span className="hidden sm:inline">Редактировать</span>
          </Button>
        ) : undefined
      }
      headerExtra={headerExtra}
      footer={footer}
      formId={showCustomTab ? undefined : FORM_ID}
      onSubmit={handleSubmit}
    >
      {showCustomTab ? (
        renderTabContent!(activeTab)
      ) : (
        <div className="space-y-4">
          {linkedBanner && mode === 'view' && (
            <div className="p-3.5 rounded-2xl bg-purple-50/80 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-800/40 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                  <Link2 className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{linkedBanner.title}</div>
                  {linkedBanner.description && (
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{linkedBanner.description}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {linkedBanner.onNavigate && (
                  <Button variant="ghost" size="xs" className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400" onClick={linkedBanner.onNavigate}>
                    {linkedBanner.navigateLabel || 'Перейти'}
                  </Button>
                )}
                {linkedBanner.onUnlink && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400"
                    disabled={linkedBanner.isUnlinking}
                    onClick={linkedBanner.onUnlink}
                    leftIcon={
                      linkedBanner.isUnlinking ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" strokeWidth={1.75} />
                      )
                    }
                  >
                    {linkedBanner.unlinkLabel || 'Отвязать'}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleFields.map((field) => {
              const fieldKey = String(field.name);
              const val = formData[fieldKey];
              const isImmutable = Boolean(field.immutable);
              const isFull = field.fullWidth || field.type === 'textarea';

              return (
                <FormField
                  key={fieldKey}
                  htmlFor={!isImmutable && mode !== 'view' ? fieldKey : undefined}
                  className={isFull ? 'sm:col-span-2' : undefined}
                  label={
                    <>
                      {isImmutable && <Lock className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />}
                      <span>{field.label}</span>
                    </>
                  }
                  required={field.required && mode !== 'view' && !isImmutable}
                  labelRight={isImmutable && !field.renderCustomView ? 'клик для копирования' : undefined}
                  hint={mode !== 'view' && !isImmutable ? field.helperText : undefined}
                >
                  {isImmutable
                    ? renderImmutable(field, fieldKey, val)
                    : mode === 'view'
                    ? renderView(field, val)
                    : renderEdit(field, fieldKey, val)}
                </FormField>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
