'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors island-interactive border border-zinc-200/40 dark:border-zinc-800/40"
      aria-label="Переключить тему оформления"
      title={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
    >
      {mounted ? (
        isDark ? (
          <Sun className="w-4.5 h-4.5" strokeWidth={1.75} />
        ) : (
          <Moon className="w-4.5 h-4.5" strokeWidth={1.75} />
        )
      ) : (
        <span className="w-4.5 h-4.5 block opacity-0" />
      )}
    </button>
  );
}
