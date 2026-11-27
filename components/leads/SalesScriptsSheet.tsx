'use client';

import * as React from 'react';
import { BookOpen, Search, Copy, Check, X, Tag, Wallet } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useModalBehavior } from '@/components/ui/Modal';
import {
  SALES_SCRIPTS,
  SALES_SCRIPT_CATEGORIES,
  fillScript,
  matchesScript,
  type SalesScript,
  type SalesScriptCategory,
} from '@/lib/sales/scripts';
import { PLATFORM_TARIFFS, formatTariffPrice, plural } from '@/lib/sales/tariffs';
import { cn } from '@/lib/utils/cn';

interface SalesScriptsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Имя сотрудника для подстановки {менеджер} */
  managerName?: string | null;
}

type CategoryFilter = 'Все' | SalesScriptCategory;

/** Короткая шпаргалка по тарифам над списком скриптов */
function TariffCheatSheet() {
  return (
    <section className="p-4 rounded-2xl backdrop-blur-xl bg-white/70 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800/60 space-y-2.5">
      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5" strokeWidth={1.75} />
        Тарифы Sotka.kg — за {PLATFORM_TARIFFS[0].periodDays} дней
      </h3>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {PLATFORM_TARIFFS.map((t) => {
          const hasInstallments = t.modules.includes('Рассрочки');
          return (
            <div key={t.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{t.name}</span>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  {formatTariffPrice(t.price)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t.points} {plural(t.points, 'точка', 'точки', 'точек')} · до {t.employees}{' '}
                {plural(t.employees, 'сотрудника', 'сотрудников', 'сотрудников')} ·{' '}
                {hasInstallments ? 'модуль рассрочек, SMS и WhatsApp-напоминания должникам' : 'без модуля рассрочек'}
                {t.id === 'business' && ' · модель телефона по IMEI при закупе'}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-400">Основные возможности — склад, продажи, аналитика — есть в любом тарифе; точки можно добавить.</p>
    </section>
  );
}

export function SalesScriptsSheet({ isOpen, onClose, managerName }: SalesScriptsSheetProps) {
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [category, setCategory] = React.useState<CategoryFilter>('Все');
  const [copiedScriptId, setCopiedScriptId] = React.useState<string | null>(null);

  // Escape, блокировка прокрутки и возврат фокуса — как у остальных окон
  useModalBehavior(isOpen, onClose);

  const grouped = React.useMemo(() => {
    const filtered = SALES_SCRIPTS.filter(
      (s) => (category === 'Все' || s.category === category) && matchesScript(s, searchQuery)
    );
    return SALES_SCRIPT_CATEGORIES.map((c) => ({ category: c, items: filtered.filter((s) => s.category === c) })).filter(
      (g) => g.items.length > 0
    );
  }, [category, searchQuery]);
  const total = grouped.reduce((sum, g) => sum + g.items.length, 0);

  if (!isOpen) return null;

  // В шторке клиент не выбран: обращение по имени убирается, имя сотрудника подставляется
  const textOf = (script: SalesScript) => fillScript(script.text, { managerName });

  const handleCopyScript = async (script: SalesScript) => {
    try {
      await navigator.clipboard.writeText(textOf(script));
    } catch {
      showToast('Не удалось скопировать текст: выделите его и скопируйте вручную', 'error');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
    setCopiedScriptId(script.id);
    showToast('Скрипт скопирован в буфер', 'success');
    setTimeout(() => {
      setCopiedScriptId(null);
    }, 1500);
  };

  const showTariffs = !searchQuery.trim() && (category === 'Все' || category === 'Тарифы');

  return (
    <div className="fixed inset-0 z-modal flex justify-end bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Скрипты продаж">
      {/* Оверлей закрытия */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Выдвигающаяся матовая панель */}
      <div
        className="relative z-10 w-full sm:max-w-lg h-full max-h-screen flex flex-col backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border-l border-white/20 dark:border-zinc-800/60 shadow-2xl overflow-hidden animate-in slide-in-from-right-8 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка шторки */}
        <div className="px-6 pt-6 pb-4 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-md flex-shrink-0">
              <BookOpen className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Скрипты продаж</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Сообщения в порядке диалога и тарифы платформы</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Поиск и разделы диалога */}
        <div className="p-4 border-b border-zinc-200/60 dark:border-zinc-800/60 space-y-3 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск: цена, ИП, рассрочка, дорого..."
              className="w-full h-9 pl-9 pr-8 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                aria-label="Очистить поиск"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {(['Все', ...SALES_SCRIPT_CATEGORIES] as CategoryFilter[]).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'px-3 py-1.5 rounded-xl font-medium whitespace-nowrap transition-all',
                  category === c
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                    : 'bg-white/80 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/60 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Шпаргалка по тарифам и скрипты по разделам */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {showTariffs && <TariffCheatSheet />}

          {total === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-xs">Скрипты по запросу не найдены</div>
          ) : (
            grouped.map((group) => (
              <section key={group.category} className="space-y-2.5">
                <h3 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center text-[9px] font-bold">
                    {SALES_SCRIPT_CATEGORIES.indexOf(group.category) + 1}
                  </span>
                  {group.category}
                </h3>
                {group.items.map((script) => {
                  const isCopied = copiedScriptId === script.id;
                  return (
                    <div
                      key={script.id}
                      onClick={() => void handleCopyScript(script)}
                      className="group relative p-4 rounded-2xl backdrop-blur-xl bg-white/70 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer shadow-sm hover:shadow-md space-y-2.5"
                    >
                      <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {script.title}
                      </h4>

                      <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line bg-zinc-50/80 dark:bg-zinc-900/50 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800/60">
                        {textOf(script)}
                      </p>

                      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-zinc-400">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <Tag className="w-3 h-3 text-zinc-400 flex-shrink-0" strokeWidth={1.75} />
                          {script.tags.map((t) => (
                            <span key={t} className="text-[10px] text-zinc-400">
                              #{t}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white flex-shrink-0">
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                              <span className="text-emerald-500 text-[11px]">Скопировано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                              <span className="text-[11px]">Скопировать</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        {/* Подвал подсказки */}
        <div className="p-4 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/80 dark:bg-zinc-900/80 text-[11px] text-zinc-400 flex items-center justify-between gap-3">
          <span>Клик по карточке копирует текст. С именем клиента — через кнопку WhatsApp у лида.</span>
          <span className="font-mono flex-shrink-0">{total}</span>
        </div>
      </div>
    </div>
  );
}
