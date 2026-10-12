/**
 * Восстановление после выкладки новой версии.
 *
 * После деплоя у открытой вкладки остается старый клиентский бандл, а его вызовы
 * server actions новый сервер уже не узнает: React выбрасывает
 * «An unexpected response was received from the server», Next —
 * «Failed to find Server Action», а динамические чанки — ChunkLoadError.
 * Единственное лечение — перезагрузить страницу, чтобы получить новую версию.
 */

const RELOAD_GUARD_KEY = 'crm_stale_deployment_reload_at';
const RELOAD_GUARD_WINDOW_MS = 60_000;

export const STALE_DEPLOYMENT_MESSAGE =
  'Вышла новая версия CRM — страница перезагружается...';

const STALE_PATTERNS = [
  /unexpected response was received from the server/i,
  /failed to find server action/i,
  /server action .* was not found/i,
  /chunkloaderror/i,
  /loading chunk \S+ failed/i,
  /failed to fetch dynamically imported module/i,
];

/** Ошибка вызвана несовпадением версий клиента и сервера после деплоя */
export function isStaleDeploymentError(err: unknown): boolean {
  if (!err) return false;
  const message =
    typeof err === 'string'
      ? err
      : `${(err as { name?: string }).name || ''} ${(err as { message?: string }).message || ''}`;
  return STALE_PATTERNS.some((re) => re.test(message));
}

/**
 * Перезагружает страницу один раз: повторная перезагрузка в течение минуты не выполняется,
 * чтобы не зациклиться, если причина ошибки не в версии.
 * Возвращает true, если перезагрузка запланирована.
 */
export function recoverFromStaleDeployment(delayMs = 1200): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage недоступен (приватный режим) — перезагружаем без защиты от повтора
  }

  window.setTimeout(() => window.location.reload(), delayMs);
  return true;
}
