'use client';

import * as React from 'react';
import {
  X,
  Pencil,
  Save,
  Copy,
  Check,
  Phone,
  MessageCircle,
  Link2,
  Lock,
  Loader2,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { PIPELINE_STATUS_OPTIONS, type StatusOption } from './DataJournal';

export type EntityModalMode = 'view' | 'edit' | 'create';

export const CIS_COUNTRIES = [
  { code: '996', label: 'KG (+996)' },
  { code: '7', label: 'KZ / RU (+7)' },
  { code: '998', label: 'UZ (+998)' },
  { code: '992', label: 'TJ (+992)' },
  { code: '375', label: 'BY (+375)' },
  { code: '994', label: 'AZ (+994)' },
  { code: '374', label: 'AM (+374)' },
  { code: '993', label: 'TM (+993)' },
  { code: '373', label: 'MD (+373)' },
];

export interface EntityFieldConfig<T> {
  name: keyof T | string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'status' | 'phone' | 'textarea' | 'currency';
  placeholder?: string;
  immutable?: boolean; // Readonly, click to copy with vibration
  isSystem?: boolean; // Hidden in create mode
  required?: boolean;
  disabled?: boolean;
  defaultValue?: any;
  options?: { value: string; label: string }[];
  helperText?: string;
  countryCodeKey?: string;
  renderCustomView?: (val: any, data: T) => React.ReactNode;
}

export interface EntityModalProps<T extends Record<string, any>> {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: EntityModalMode;
  title?: string;
  data: T | null;
  fields: EntityFieldConfig<T>[];
  keyField?: keyof T;
  phoneField?: keyof T;
  statusField?: keyof T;
  statusOptions?: StatusOption[];
  onSave?: (updatedData: T) => Promise<void> | void;
  onCreate?: (newData: Partial<T>) => Promise<void> | void;
  onStatusChange?: (newStatus: string) => Promise<void> | void;
  onLinkSeller?: (data: T) => void;
  createSubmitLabel?: string;
}

export function EntityModal<T extends Record<string, any>>({
  isOpen,
  onClose,
  initialMode = 'view',
  title,
  data,
  fields,
  keyField = 'id' as keyof T,
  phoneField = 'phone' as keyof T,
  statusField = 'status' as keyof T,
  statusOptions = PIPELINE_STATUS_OPTIONS,
  onSave,
  onCreate,
  onStatusChange,
  onLinkSeller,
  createSubmitLabel = 'Сохранить запись',
}: EntityModalProps<T>) {
  const { showToast } = useToast();

  const [mode, setMode] = React.useState<EntityModalMode>(initialMode);
  const [formData, setFormData] = React.useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copiedFieldName, setCopiedFieldName] = React.useState<string | null>(null);

  // Синхронизация режима и данных при открытии
  React.useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      if (initialMode === 'create') {
        const initialForm: Record<string, any> = {};
        fields.forEach((f) => {
          if (!f.isSystem) {
            if (f.defaultValue !== undefined) {
              initialForm[String(f.name)] = f.defaultValue;
            } else if (f.type === 'status') {
              initialForm[String(f.name)] = statusOptions[0]?.value || 'Открыт';
            } else if (f.type === 'phone') {
              initialForm[String(f.name)] = '';
              const cKey = f.countryCodeKey || 'country_code';
              initialForm[cKey] = '996';
            } else {
              initialForm[String(f.name)] = '';
            }
          }
        });
        if (data) {
          Object.entries(data).forEach(([k, v]) => {
            if (v !== undefined && v !== null) {
              initialForm[k] = v;
            }
          });
        }
        setFormData(initialForm);
      } else if (data) {
        setFormData({ ...data });
      }
    }
  }, [isOpen, initialMode, data, fields, statusOptions]);

  if (!isOpen) return null;

  // Обработка неизменяемых полей (click to copy)
  const handleCopyImmutable = (value: string, fieldKey: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(30);
    }
    setCopiedFieldName(fieldKey);
    showToast('Скопировано в буфер', 'success');
    setTimeout(() => {
      setCopiedFieldName(null);
    }, 1500);
  };

  // Изменение полей в режимах edit / create
  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  // Быстрая смена статуса из QuickActionBar
  const handleQuickStatusChange = async (newStatus: string) => {
    if (onStatusChange) {
      setIsSubmitting(true);
      try {
        await onStatusChange(newStatus);
        setFormData((prev) => ({ ...prev, [String(statusField)]: newStatus }));
        showToast(`Статус обновлен: ${newStatus}`, 'success');
      } catch (err: any) {
        showToast(err?.message || 'Ошибка при обновлении статуса', 'error');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Сохранение формы
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

  // Отмена редактирования
  const handleCancelEdit = () => {
    if (mode === 'edit') {
      if (data) setFormData({ ...data });
      setMode('view');
    } else {
      onClose();
    }
  };

  // Данные для шапки и действий связи
  const currentRecordId = data ? String(data[keyField] ?? '') : '';
  const currentPhone = data ? String(data[phoneField] ?? '') : '';
  const cleanPhoneDigits = currentPhone.replace(/\D/g, '');
  const currentStatus = data ? String(data[statusField] ?? '') : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Матовый кликабельный оверлей */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Адаптивный контейнер: Центрированный островок на ПК / Bottom Sheet на мобильных */}
      <div
        className="relative z-10 w-full lg:max-w-2xl max-h-[90vh] flex flex-col backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border border-white/20 dark:border-zinc-800/60 shadow-2xl rounded-t-3xl lg:rounded-3xl overflow-hidden animate-in slide-in-from-bottom-6 lg:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Индикатор свайпа для мобильных устройств */}
        <div className="lg:hidden pt-3 pb-1 flex justify-center">
          <div className="w-12 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
        </div>

        {/* 1. ШАПКА ФОРМЫ */}
        <div className="px-6 pt-5 pb-4 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {mode === 'create'
                ? `Создание: ${title || 'Новая запись'}`
                : mode === 'edit'
                ? `Редактирование: ${title || 'Запись'}`
                : title || 'Карточка записи'}
            </h2>
            {currentRecordId && mode !== 'create' && (
              <p className="text-[11px] font-mono text-zinc-400 mt-0.5 truncate">
                ID: {currentRecordId}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Кнопка переключения в режим редактирования */}
            {mode === 'view' && Boolean(onSave) && (
              <button
                onClick={() => setMode('edit')}
                className="h-8 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="Редактировать запись"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span className="hidden sm:inline">Редактировать</span>
              </button>
            )}

            {/* Кнопка закрытия */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* 2. ОСТРОВОК БЫСТРЫХ ДЕЙСТВИЙ (QuickActionBar) в режиме View */}
        {mode === 'view' && data && (
          <div className="px-6 py-3 bg-zinc-100/60 dark:bg-zinc-800/40 border-b border-zinc-200/50 dark:border-zinc-800/50 flex flex-wrap items-center justify-between gap-3">
            {/* Блок связи */}
            <div className="flex items-center gap-2">
              {cleanPhoneDigits && (
                <>
                  <a
                    href={`tel:${cleanPhoneDigits}`}
                    className="h-8 px-3 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium flex items-center gap-1.5 transition-colors"
                    title="Позвонить"
                  >
                    <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>Звонок</span>
                  </a>

                  <a
                    href={`https://wa.me/${cleanPhoneDigits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="h-8 px-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-1.5 transition-colors"
                    title="WhatsApp"
                  >
                    <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>WhatsApp</span>
                  </a>
                </>
              )}

              {/* Кнопка привязки продавца */}
              {onLinkSeller && (
                <button
                  onClick={() => onLinkSeller(data)}
                  className="h-8 px-3 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-medium flex items-center gap-1.5 transition-colors"
                  title="Связать с продавцом"
                >
                  <Link2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>Привязать</span>
                </button>
              )}
            </div>

            {/* Быстрый переключатель статуса в 1 клик */}
            {onStatusChange && (
              <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                {statusOptions.map((opt) => {
                  const isActive = currentStatus === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleQuickStatusChange(opt.value)}
                      disabled={isSubmitting || isActive}
                      className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5 ${
                        isActive
                          ? `${opt.colorClass} ring-2 ring-zinc-400/40 font-bold`
                          : 'bg-white/50 dark:bg-zinc-900/50 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${opt.dotColor || 'bg-current'}`} />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 3. ТЕЛО ФОРМЫ (Скроллируемый список полей) */}
        <form id="entity-modal-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields
              .filter((f) => mode !== 'create' || !f.isSystem)
              .map((field) => {
                const fieldKey = String(field.name);
                const val = formData[fieldKey];
                const isImmutable = field.immutable;

                return (
                  <div
                    key={fieldKey}
                    className={`${
                      field.type === 'textarea' ? 'sm:col-span-2' : ''
                    } space-y-1.5`}
                  >
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                        {isImmutable && <Lock className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />}
                        <span>{field.label}</span>
                        {field.required && mode !== 'view' && (
                          <span className="text-rose-500">*</span>
                        )}
                      </label>

                      {/* Индикатор кликабельности для неизменяемых полей */}
                      {isImmutable && (
                        <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                          клик для копирования
                        </span>
                      )}
                    </div>

                    {/* СЦЕНАРИЙ 1: Неизменяемое поле (Immutable: ID, created_at, external) */}
                    {isImmutable ? (
                      <div
                        onClick={() => handleCopyImmutable(String(val ?? ''), fieldKey)}
                        className="group relative flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-xs font-mono text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 select-all transition-colors"
                        title="Нажмите для копирования значения"
                      >
                        <span className="truncate">{String(val || '—')}</span>
                        <div className="pl-2">
                          {copiedFieldName === fieldKey ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 transition-colors" strokeWidth={1.75} />
                          )}
                        </div>
                      </div>
                    ) : mode === 'view' ? (
                      /* СЦЕНАРИЙ 2: Режим View (статический текст/бейдж) */
                      <div className="min-h-[38px] px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/40 dark:border-zinc-800/40 text-xs text-zinc-900 dark:text-zinc-100 flex items-center">
                        {field.renderCustomView ? (
                          field.renderCustomView(val, formData as T)
                        ) : field.type === 'phone' ? (
                          <div className="flex items-center gap-2 font-mono">
                            <span className="px-2 py-0.5 rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-semibold">
                              +{String(formData[field.countryCodeKey || 'country_code'] || '996')}
                            </span>
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{String(val || '—')}</span>
                          </div>
                        ) : field.type === 'status' ? (
                          (() => {
                            const opt = statusOptions.find((o) => o.value === val);
                            return (
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                                  opt?.colorClass || 'bg-zinc-200 text-zinc-700'
                                }`}
                              >
                                {opt?.label || String(val ?? '—')}
                              </span>
                            );
                          })()
                        ) : field.type === 'currency' ? (
                          <span className="font-semibold">
                            {Number(val || 0).toLocaleString('ru-RU')} сом
                          </span>
                        ) : (
                          <span className="break-words">{String(val ?? '—')}</span>
                        )}
                      </div>
                    ) : (
                      /* СЦЕНАРИЙ 3: Режим Edit / Create (интерактивные инпуты) */
                      <div>
                        {field.type === 'phone' ? (
                          <div className="flex items-center gap-2">
                            <select
                              value={String(formData[field.countryCodeKey || 'country_code'] || '996')}
                              onChange={(e) => handleFieldChange(field.countryCodeKey || 'country_code', e.target.value)}
                              disabled={field.disabled}
                              className={`w-36 h-9 px-2.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all flex-shrink-0 ${
                                field.disabled ? 'opacity-60 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800' : ''
                              }`}
                            >
                              {CIS_COUNTRIES.map((c) => (
                                <option key={c.code + c.label} value={c.code}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                            <input
                              type="tel"
                              value={val ?? ''}
                              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                              required={field.required}
                              disabled={field.disabled}
                              placeholder={field.placeholder || '700123456'}
                              className={`flex-1 h-9 px-3 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all ${
                                field.disabled ? 'opacity-60 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800' : ''
                              }`}
                            />
                          </div>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            value={val ?? ''}
                            onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                            required={field.required}
                            disabled={field.disabled}
                            rows={3}
                            placeholder={field.placeholder || field.label}
                            className={`w-full px-3 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all ${
                              field.disabled ? 'opacity-60 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800' : ''
                            }`}
                          />
                        ) : field.type === 'select' || field.type === 'status' ? (
                          <select
                            value={val ?? ''}
                            onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                            required={field.required}
                            disabled={field.disabled}
                            className={`w-full h-9 px-3 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all ${
                              field.disabled ? 'opacity-60 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800' : ''
                            }`}
                          >
                            {(field.options || statusOptions).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {field.type === 'status' && !opt.label.startsWith('●')
                                  ? `● ${opt.label}`
                                  : opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type === 'number' || field.type === 'currency' ? 'number' : 'text'}
                            value={val ?? ''}
                            onChange={(e) =>
                              handleFieldChange(
                                fieldKey,
                                field.type === 'number' || field.type === 'currency'
                                  ? Number(e.target.value)
                                  : e.target.value
                              )
                            }
                            required={field.required}
                            disabled={field.disabled}
                            placeholder={field.placeholder || field.label}
                            className={`w-full h-9 px-3 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all ${
                              field.disabled ? 'opacity-60 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800' : ''
                            }`}
                          />
                        )}
                        {field.helperText && (
                          <p className="text-[10px] text-zinc-400 mt-1">{field.helperText}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </form>

        {/* 4. ПОДВАЛ (Footer) */}
        <div className="px-6 py-4 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/80 dark:bg-zinc-900/80 flex items-center justify-end gap-2.5">
          {mode === 'view' ? (
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold transition-colors"
            >
              Закрыть
            </button>
          ) : mode === 'edit' ? (
            <>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isSubmitting}
                className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Отмена</span>
              </button>

              <button
                type="submit"
                form="entity-modal-form"
                disabled={isSubmitting}
                className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-md flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Save className="w-3.5 h-3.5" strokeWidth={2} />
                )}
                <span>Сохранить</span>
              </button>
            </>
          ) : (
            /* Mode === 'create' */
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>

              <button
                type="submit"
                form="entity-modal-form"
                disabled={isSubmitting}
                className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-md flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Save className="w-3.5 h-3.5" strokeWidth={2} />
                )}
                <span>{createSubmitLabel}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
