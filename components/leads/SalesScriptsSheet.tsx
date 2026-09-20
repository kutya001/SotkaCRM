'use client';

import * as React from 'react';
import {
  BookOpen,
  Search,
  Copy,
  Check,
  X,
  Sparkles,
  Tag,
  ChevronRight,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import salesScriptsData from '@/data/sales-scripts.json';

export interface SalesScript {
  id: string;
  stage: string;
  title: string;
  category: string;
  text: string;
  tags: string[];
}

interface SalesScriptsSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const STAGES = ['Все', 'Открыт', 'Обработан', 'Назначен', 'Подписан'];

const STAGE_COLORS: Record<string, string> = {
  'Открыт': 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  'Обработан': 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
  'Назначен': 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  'Подписан': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
};

export function SalesScriptsSheet({ isOpen, onClose }: SalesScriptsSheetProps) {
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedStage, setSelectedStage] = React.useState('Все');
  const [copiedScriptId, setCopiedScriptId] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const scripts = salesScriptsData as SalesScript[];

  const filteredScripts = scripts.filter((item) => {
    if (selectedStage !== 'Все' && item.stage !== selectedStage) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchText = item.text.toLowerCase().includes(q);
      const matchCategory = item.category.toLowerCase().includes(q);
      const matchTags = item.tags.some((t) => t.toLowerCase().includes(q));
      return matchTitle || matchText || matchCategory || matchTags;
    }
    return true;
  });

  const handleCopyScript = (script: SalesScript) => {
    navigator.clipboard.writeText(script.text);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
    setCopiedScriptId(script.id);
    showToast('Скрипт скопирован в буфер', 'success');
    setTimeout(() => {
      setCopiedScriptId(null);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Оверлей закрытия */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Выдвигающаяся матовая панель: Slide-over на ПК / Bottom Sheet на мобильных */}
      <div
        className="relative z-10 w-full sm:max-w-lg h-full max-h-screen flex flex-col backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border-l border-white/20 dark:border-zinc-800/60 shadow-2xl overflow-hidden animate-in slide-in-from-right-8 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка шторки */}
        <div className="px-6 pt-6 pb-4 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-md">
              <BookOpen className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Скрипты продаж
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Регламенты диалогов и отработка возражений
              </p>
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

        {/* Панель поиска и фильтров по этапам воронки */}
        <div className="p-4 border-b border-zinc-200/60 dark:border-zinc-800/60 space-y-3 bg-zinc-50/50 dark:bg-zinc-900/50">
          {/* Поле поиска */}
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по фразам, возражениям или тегам..."
              className="w-full h-9 pl-9 pr-8 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>

          {/* Фильтр-чипы этапов воронки */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {STAGES.map((stage) => {
              const isSelected = selectedStage === stage;
              return (
                <button
                  key={stage}
                  onClick={() => setSelectedStage(stage)}
                  className={`px-3 py-1.5 rounded-xl font-medium whitespace-nowrap transition-all ${
                    isSelected
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                      : 'bg-white/80 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/60 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {stage}
                </button>
              );
            })}
          </div>
        </div>

        {/* Скроллируемый список карточек скриптов */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredScripts.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-xs">
              Сценарии диалогов по запросу не найдены
            </div>
          ) : (
            filteredScripts.map((script) => {
              const isCopied = copiedScriptId === script.id;
              const badgeClass =
                STAGE_COLORS[script.stage] || 'bg-zinc-200 text-zinc-700';

              return (
                <div
                  key={script.id}
                  onClick={() => handleCopyScript(script)}
                  className="group relative p-4 rounded-2xl backdrop-blur-xl bg-white/70 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer shadow-sm hover:shadow-md space-y-2.5"
                >
                  {/* Заголовок и бейдж этапа */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                        {script.category}
                      </span>
                      <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {script.title}
                      </h3>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeClass}`}
                    >
                      {script.stage}
                    </span>
                  </div>

                  {/* Текст реплики */}
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed bg-zinc-50/80 dark:bg-zinc-900/50 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800/60">
                    {script.text}
                  </p>

                  {/* Подвал карточки: теги и кнопка копирования */}
                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-zinc-400">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Tag className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />
                      {script.tags.map((t) => (
                        <span key={t} className="text-[10px] text-zinc-400">
                          #{t}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white">
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
            })
          )}
        </div>

        {/* Подвал подсказки */}
        <div className="p-4 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/80 dark:bg-zinc-900/80 text-[11px] text-zinc-400 flex items-center justify-between">
          <span>Клик по карточке копирует текст в буфер</span>
          <span className="font-mono">{filteredScripts.length} сценариев</span>
        </div>
      </div>
    </div>
  );
}
