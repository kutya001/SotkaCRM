'use client';

import * as React from 'react';
import { Send, KeyRound, ArrowLeft, Loader2, CheckCircle2, AlertCircle, User, Lock } from 'lucide-react';

const inputClass =
  'w-full h-11 pl-10 pr-4 text-sm bg-white/60 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700/60 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all';

async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: json?.error || 'Ошибка запроса' };
  return { ok: true, message: json?.message || '' };
}

/** Восстановление пароля по коду из Telegram: логин → код в чате бота → новый пароль */
export function PasswordResetPanel({ initialLogin, onBack }: { initialLogin?: string; onBack: () => void }) {
  const [step, setStep] = React.useState<'login' | 'code' | 'done'>('login');
  const [login, setLogin] = React.useState(initialLogin || '');
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsPending(true);
    try {
      const res = await post('/api/v1/auth/password-reset/request', { login });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setInfo(res.message);
      setStep('code');
    } catch {
      setError('Не удалось отправить запрос. Проверьте соединение.');
    } finally {
      setIsPending(false);
    }
  };

  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setIsPending(true);
    try {
      const res = await post('/api/v1/auth/password-reset/confirm', { login, code, password });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setInfo(res.message);
      setStep('done');
    } catch {
      setError('Не удалось изменить пароль. Проверьте соединение.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
          <Send className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Восстановление пароля</h2>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Код придет в Telegram, если он подключен в вашем профиле</p>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {step === 'login' && (
        <form onSubmit={requestCode} className="space-y-4">
          <div>
            <label htmlFor="reset-login" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Логин
            </label>
            <div className="relative flex items-center">
              <User className="w-4 h-4 absolute left-3.5 text-zinc-400 pointer-events-none" strokeWidth={1.75} />
              <input
                id="reset-login"
                type="text"
                required
                autoFocus
                autoComplete="username"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="ваш логин"
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isPending || !login.trim()}
            className="w-full h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={1.75} />}
            <span>Получить код в Telegram</span>
          </button>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Код можно также запросить командой <code className="font-mono">/password</code> в чате с ботом. Если Telegram не подключен, обратитесь к
            администратору — он сбросит пароль.
          </p>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={confirmCode} className="space-y-4">
          {info && (
            <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-800 dark:text-sky-200 text-xs">{info}</div>
          )}
          <div>
            <label htmlFor="reset-code" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Код из Telegram
            </label>
            <div className="relative flex items-center">
              <KeyRound className="w-4 h-4 absolute left-3.5 text-zinc-400 pointer-events-none" strokeWidth={1.75} />
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 цифр"
                className={`${inputClass} font-mono tracking-[0.3em]`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="reset-password" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Новый пароль
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 absolute left-3.5 text-zinc-400 pointer-events-none" strokeWidth={1.75} />
              <input
                id="reset-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="минимум 6 символов"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="reset-confirm" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Повторите пароль
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 absolute left-3.5 text-zinc-400 pointer-events-none" strokeWidth={1.75} />
              <input
                id="reset-confirm"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isPending || code.length !== 6}
            className="w-full h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" strokeWidth={1.75} />}
            <span>Сменить пароль</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('login');
              setCode('');
              setError('');
            }}
            className="w-full text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Код не пришел? Запросить снова
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
          <span>{info || 'Пароль изменен. Войдите с новым паролем.'}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-2 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
        {step === 'done' ? 'Перейти ко входу' : 'Назад ко входу'}
      </button>
    </div>
  );
}
