'use client';

import * as React from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, MessageCircle, Search, X } from 'lucide-react';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { formatPhoneDisplay, waHref } from '@/lib/utils/phone';
import {
  SALES_SCRIPTS,
  SALES_SCRIPT_CATEGORIES,
  fillScript,
  manualFieldsOf,
  matchesScript,
  type SalesScript,
  type SalesScriptCategory,
} from '@/lib/sales/scripts';
import { cn } from '@/lib/utils/cn';

export interface WhatsAppTarget {
  phone: string;
  countryCode?: string | null;
  clientName?: string | null;
}

interface WhatsAppScriptModalProps {
  target: WhatsAppTarget | null;
  onClose: () => void;
  /** Имя сотрудника для подстановки {менеджер} */
  managerName?: string | null;
}

type CategoryFilter = 'Все' | SalesScriptCategory;

/**
 * Окно перед переходом в WhatsApp: открыть чат без текста или выбрать скрипт продаж,
 * поправить текст и открыть чат с готовым сообщением (или скопировать его).
 */
export function WhatsAppScriptModal({ target, onClose, managerName }: WhatsAppScriptModalProps) {
  const { showToast } = useToast();
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<CategoryFilter>('Все');
  const [selected, setSelected] = React.useState<SalesScript | null>(null);
  const [draft, setDraft] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  // Скрипты, уже отправленные в этом окне: отмечаются галочкой, чтобы идти по порядку
  const [sentIds, setSentIds] = React.useState<string[]>([]);

  const phoneKey = target ? `${target.countryCode || ''}:${target.phone}` : '';
  React.useEffect(() => {
    setQuery('');
    setCategory('Все');
    setSelected(null);
    setDraft('');
    setSentIds([]);
  }, [phoneKey]);

  const fillContext = React.useMemo(
    () => ({ clientName: target?.clientName, managerName }),
    [target?.clientName, managerName]
  );

  const filtered = React.useMemo(
    () => SALES_SCRIPTS.filter((s) => (category === 'Все' || s.category === category) && matchesScript(s, query)),
    [category, query]
  );
  const grouped = React.useMemo(
    () =>
      SALES_SCRIPT_CATEGORIES.map((c) => ({ category: c, items: filtered.filter((s) => s.category === c) })).filter(
        (g) => g.items.length > 0
      ),
    [filtered]
  );

  if (!target) return null;

  const phoneDisplay = formatPhoneDisplay(target.phone, target.countryCode);
  const plainChatHref = waHref(target.phone, target.countryCode);
  const manualFields = selected ? manualFieldsOf(draft) : [];

  const openScript = (script: SalesScript) => {
    setSelected(script);
    setDraft(fillScript(script.text, fillContext));
    setCopied(false);
  };

  const backToList = () => {
    setSelected(null);
    setCopied(false);
  };

  const markSent = () => {
    if (selected) setSentIds((ids) => (ids.includes(selected.id) ? ids : [...ids, selected.id]));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      markSent();
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50);
      showToast('Текст скопирован', 'success');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast('Не удалось скопировать текст: выделите его и скопируйте вручную', 'error');
    }
  };

  const handleSend = () => {
    // Переход выполняет сама ссылка; окно остается открытым для следующего скрипта
    markSent();
    backToList();
  };

  const footer = selected ? (
    <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
      <Button
        variant="secondary"
        onClick={handleCopy}
        disabled={!draft.trim()}
        leftIcon={
          copied ? (
            <Check className="w-4 h-4 text-emerald-500" strokeWidth={2} />
          ) : (
            <Copy className="w-4 h-4" strokeWidth={1.75} />
          )
        }
      >
        {copied ? 'Скопировано' : 'Скопировать'}
      </Button>
      <ButtonLink
        href={draft.trim() ? waHref(target.phone, target.countryCode, draft) : plainChatHref}
        target="_blank"
        variant="success"
        onClick={handleSend}
        leftIcon={<MessageCircle className="w-4 h-4" strokeWidth={1.75} />}
      >
        Открыть WhatsApp с текстом
      </ButtonLink>
    </div>
  ) : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      level={2}
      size="lg"
      tone="success"
      icon={MessageCircle}
      title="Написать в WhatsApp"
      subtitle={[target.clientName?.trim(), phoneDisplay].filter(Boolean).join(' · ')}
      footer={footer}
    >
      {selected ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
            Все скрипты
          </button>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400">{selected.category}</p>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{selected.title}</h3>
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={9}
            aria-label="Текст сообщения"
            className="text-sm leading-relaxed"
          />
          {manualFields.length > 0 && (
            <ModalCallout tone="warning">
              Заполните перед отправкой: {manualFields.map((f) => `[${f}]`).join(', ')}
            </ModalCallout>
          )}
          <p className="text-[11px] text-zinc-400">
            Текст можно поправить. «Открыть WhatsApp» вставит его в чат с клиентом — останется нажать «Отправить».
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <ButtonLink
            href={plainChatHref}
            target="_blank"
            variant="outline"
            fullWidth
            size="lg"
            onClick={onClose}
            leftIcon={<MessageCircle className="w-4 h-4 text-emerald-500" strokeWidth={1.75} />}
          >
            Открыть чат без текста
          </ButtonLink>

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            или выберите скрипт
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <div className="space-y-2.5">
            <div className="relative">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск: цена, ИП, рассрочка, дорого..."
                className="w-full h-9 pl-9 pr-8 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label="Очистить поиск"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {(['Все', ...SALES_SCRIPT_CATEGORIES] as CategoryFilter[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all',
                    category === c
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                      : 'bg-zinc-100 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {grouped.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">Скрипты по запросу не найдены</p>
          ) : (
            <div className="space-y-4">
              {grouped.map((group) => (
                <section key={group.category} className="space-y-1.5">
                  <h4 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center text-[9px] font-bold">
                      {SALES_SCRIPT_CATEGORIES.indexOf(group.category) + 1}
                    </span>
                    {group.category}
                  </h4>
                  {group.items.map((script) => {
                    const sent = sentIds.includes(script.id);
                    return (
                      <button
                        key={script.id}
                        type="button"
                        onClick={() => openScript(script)}
                        className="w-full text-left p-3 rounded-2xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors flex items-start gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                            <span className="truncate">{script.title}</span>
                            {sent && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                                <Check className="w-3 h-3" strokeWidth={2} />
                                отправлен
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 whitespace-pre-line">
                            {fillScript(script.text, fillContext)}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-300 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
