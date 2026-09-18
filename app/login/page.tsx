'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { login, type AuthState } from '@/app/auth/actions';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Layers, Lock, User, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

const initialState: AuthState = {
  error: '',
};

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-zinc-100 dark:bg-zinc-950">
      {/* Мягкие фоновые световые пятна */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 dark:bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 dark:bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Верхний островок переключателя темы */}
      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle />
      </div>

      {/* Матовая карточка авторизации Apple Island */}
      <div className="w-full max-w-md backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 rounded-3xl p-8 sm:p-10 shadow-2xl relative z-10">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center mb-4 shadow-lg">
            <Layers className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            SotkaCRM
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Авторизация в системе управления продажами
          </p>
        </div>

        {state?.error && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
            <span>{state.error}</span>
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div>
            <label
              htmlFor="identifier"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Логин или Email
            </label>
            <div className="relative flex items-center">
              <User
                className="w-4 h-4 absolute left-3.5 text-zinc-400 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                id="identifier"
                name="identifier"
                type="text"
                required
                autoComplete="username"
                placeholder="admin или operator@sotka.kg"
                className="w-full h-11 pl-10 pr-4 text-sm bg-white/60 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700/60 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Пароль
            </label>
            <div className="relative flex items-center">
              <Lock
                className="w-4 h-4 absolute left-3.5 text-zinc-400 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full h-11 pl-10 pr-4 text-sm bg-white/60 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700/60 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isPending}
              className="w-full h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold flex items-center justify-center gap-2 shadow-lg island-interactive transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                  <span>Вход в систему...</span>
                </>
              ) : (
                <>
                  <span>Войти</span>
                  <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-8 pt-6 border-t border-zinc-200/50 dark:border-zinc-800/50 text-center">
          <p className="text-[11px] text-zinc-400">
            Доступ строго по регламенту безопасности SotkaCRM
          </p>
        </div>
      </div>
    </div>
  );
}
