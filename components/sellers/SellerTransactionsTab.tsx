'use client';

import * as React from 'react';
import { api } from '@/lib/api/client';
import { FormattedDate } from '@/components/ui/FormattedDate';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  RotateCcw,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface SellerTransactionsTabProps {
  sellerPhoneOrId: string;
}

export function SellerTransactionsTab({ sellerPhoneOrId }: SellerTransactionsTabProps) {
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<{
    transactions: {
      items: Array<{
        id?: string | number;
        date?: string;
        type?: string;
        description?: string;
        amount?: number;
        status?: string;
      }>;
      total: number;
      total_topups: number;
      total_charges: number;
      total_amount: number;
    };
    warning?: string;
  } | null>(null);

  const fetchTransactions = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.sellers.getTransactions(sellerPhoneOrId);
      setData(res);
    } catch (err: any) {
      console.error('Ошибка загрузки транзакций:', err);
      setError(err.message || 'Не удалось загрузить транзакции из Sotka HQ');
    } finally {
      setIsLoading(false);
    }
  }, [sellerPhoneOrId]);

  React.useEffect(() => {
    if (sellerPhoneOrId) {
      fetchTransactions();
    }
  }, [sellerPhoneOrId, fetchTransactions]);

  if (isLoading) {
    return (
      <div className="py-12 text-center space-y-3">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500" strokeWidth={2} />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Загрузка транзакций из Sotka HQ API...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40 space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" strokeWidth={1.75} />
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">{error}</p>
        <button
          type="button"
          onClick={fetchTransactions}
          className="h-8 px-3 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Повторить</span>
        </button>
      </div>
    );
  }

  const tx = data?.transactions || {
    items: [],
    total: 0,
    total_topups: 0,
    total_charges: 0,
    total_amount: 0,
  };

  return (
    <div className="space-y-4">
      {data?.warning && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          {data.warning}
        </div>
      )}

      {/* 1. Сводные метрики транзакций */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Баланс */}
        <div className="p-3.5 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <Wallet className="w-4 h-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Баланс Sotka HQ</div>
            <div className="text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100 truncate">
              {Number(tx.total_amount || 0).toLocaleString('ru-RU')} KGS
            </div>
          </div>
        </div>

        {/* Пополнения */}
        <div className="p-3.5 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <ArrowUpRight className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Пополнения</div>
            <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400 truncate">
              +{Number(tx.total_topups || 0).toLocaleString('ru-RU')} KGS
            </div>
          </div>
        </div>

        {/* Списания */}
        <div className="p-3.5 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
            <ArrowDownRight className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Списания</div>
            <div className="text-sm font-bold font-mono text-rose-600 dark:text-rose-400 truncate">
              -{Number(tx.total_charges || 0).toLocaleString('ru-RU')} KGS
            </div>
          </div>
        </div>
      </div>

      {/* 2. Таблица транзакций */}
      {tx.items.length === 0 ? (
        <div className="py-10 text-center rounded-2xl bg-zinc-50/50 dark:bg-zinc-800/30 border border-zinc-200/60 dark:border-zinc-700/60 space-y-2">
          <Receipt className="w-8 h-8 text-zinc-400 mx-auto" strokeWidth={1.5} />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Транзакции в системе Sotka HQ не найдены
          </p>
        </div>
      ) : (
        <div className="border border-zinc-200/70 dark:border-zinc-800/70 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto max-h-[360px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-100/80 dark:bg-zinc-800/80 border-b border-zinc-200/70 dark:border-zinc-800/70 sticky top-0 z-10 backdrop-blur-md">
                <tr>
                  <th className="py-2.5 px-3 font-semibold text-zinc-600 dark:text-zinc-400">
                    Дата и время
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-zinc-600 dark:text-zinc-400">
                    Тип
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-zinc-600 dark:text-zinc-400">
                    Описание
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-zinc-600 dark:text-zinc-400 text-right">
                    Сумма
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-zinc-600 dark:text-zinc-400 text-center">
                    Статус
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/40 dark:divide-zinc-800/40">
                {tx.items.map((item, idx) => {
                  const amt = Number(item.amount || 0);
                  const isPositive = amt > 0;
                  return (
                    <tr
                      key={item.id || idx}
                      className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="py-2 px-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        <FormattedDate date={item.date} type="dateTime" fallback="—" />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                          {item.type || 'Операция'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate" title={item.description}>
                        {item.description || '—'}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono font-bold whitespace-nowrap ${
                          isPositive
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        {isPositive ? `+${amt.toLocaleString('ru-RU')}` : amt.toLocaleString('ru-RU')}{' '}
                        <span className="text-[10px] font-normal text-zinc-400">KGS</span>
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {item.status || 'Успешно'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
