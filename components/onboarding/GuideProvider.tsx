'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api/client';
import { APP_VERSION, entriesSince, type ChangelogEntry } from '@/lib/changelog';
import { ALL_TOURS_ID, isTourAvailable, stepsFor, tourById, tourForPath, type TourDef, type TourStep } from '@/lib/onboarding/tours';
import { TourOverlay } from './TourOverlay';
import { WhatsNewModal } from './WhatsNewModal';

type TourStatus = 'in_progress' | 'completed' | 'skipped';

interface LocalProgress {
  status: TourStatus;
  steps_seen: number;
  total_steps: number;
}

interface GuideContextValue {
  /** Тур модуля для текущего маршрута, если он доступен роли */
  currentTour: TourDef | null;
  startTour: (tourId: string) => void;
  openWhatsNew: () => void;
  /** Новую версию еще не смотрели в этом браузере */
  hasUnseenVersion: boolean;
  /** Обучение отключено сотрудником («Больше не показывать») */
  disabled: boolean;
  setDisabled: (value: boolean) => void;
  progress: Record<string, LocalProgress>;
}

const GuideContext = React.createContext<GuideContextValue | null>(null);

/** Подсказки и обучение (null на маршрутах без оболочки: вход, документация API) */
export function useGuide(): GuideContextValue | null {
  return React.useContext(GuideContext);
}

const SEEN_VERSION_KEY = 'sotka_seen_version';
/** Пауза перед автозапуском тура: страница успевает загрузить данные */
const AUTOSTART_DELAY_MS = 1500;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const isFinished = (p?: LocalProgress) => p?.status === 'completed' || p?.status === 'skipped';

/** Открыто ли окно (блокировка прокрутки страницы ставится всеми окнами CRM) */
const isModalOpen = () => typeof document !== 'undefined' && document.body.style.overflow === 'hidden';

/**
 * Обучение и журнал версий в оболочке приложения:
 *  - после обновления один раз показывает «Что нового» (версия запоминается в браузере);
 *  - затем запускает общий тур «Знакомство», а в каждом модуле при первом открытии — тур модуля
 *    с шагами под права роли; прохождение пишется в /api/v1/onboarding (и в браузер — до миграции 049);
 *  - справка «?» и значок версии вызывают тур и журнал вручную.
 */
export function GuideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useUser();
  const userId = user.profile?.user_id || null;
  const ready = Boolean(userId) && !user.isLoading;
  const cacheKey = userId ? `sotka_onboarding_${userId}` : null;
  const canRef = React.useRef(user.can);
  canRef.current = user.can;

  const [progress, setProgress] = React.useState<Record<string, LocalProgress>>({});
  const [loaded, setLoaded] = React.useState(false);
  const [active, setActive] = React.useState<{ tour: TourDef; steps: TourStep[]; key: number } | null>(null);
  const [whatsNew, setWhatsNew] = React.useState<{ open: boolean; entries?: ChangelogEntry[] }>({ open: false });
  const [versionChecked, setVersionChecked] = React.useState(false);
  const [hasUnseenVersion, setHasUnseenVersion] = React.useState(false);

  // Прогресс: сразу из браузера, затем с сервера (сервер главнее)
  React.useEffect(() => {
    if (!ready || !cacheKey) return;
    let cancelled = false;
    const local = readJson<Record<string, LocalProgress>>(cacheKey, {});
    setProgress(local);
    setLoaded(false);
    api.onboarding
      .getMine()
      .then((res) => {
        if (cancelled || !res.available) return;
        const merged = { ...local };
        for (const row of res.progress) {
          merged[row.tour_id] = { status: row.status, steps_seen: row.steps_seen, total_steps: row.total_steps };
        }
        setProgress(merged);
        writeJson(cacheKey, merged);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, cacheKey]);

  // «Что нового»: версия, которую этот браузер еще не видел, показывается один раз
  React.useEffect(() => {
    if (!ready || versionChecked) return;
    let lastSeen: string | null = null;
    try {
      lastSeen = localStorage.getItem(SEEN_VERSION_KEY);
    } catch {}
    const unseen = lastSeen !== APP_VERSION;
    setHasUnseenVersion(unseen);
    if (unseen) setWhatsNew({ open: true, entries: entriesSince(lastSeen) });
    setVersionChecked(true);
  }, [ready, versionChecked]);

  const closeWhatsNew = React.useCallback(() => {
    setWhatsNew({ open: false });
    setHasUnseenVersion(false);
    try {
      localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    } catch {}
  }, []);

  const saveProgress = React.useCallback(
    (tourId: string, status: TourStatus, stepsSeen: number, total: number, version?: number) => {
      setProgress((prev) => {
        const next = { ...prev, [tourId]: { status, steps_seen: stepsSeen, total_steps: total } };
        if (cacheKey) writeJson(cacheKey, next);
        return next;
      });
      api.onboarding
        .save({ tour_id: tourId, status, steps_seen: stepsSeen, total_steps: total, tour_version: version })
        .catch(() => undefined);
    },
    [cacheKey]
  );

  const begin = React.useCallback(
    (tourId: string) => {
      const tour = tourById(tourId);
      if (!tour || !isTourAvailable(tour, canRef.current)) return;
      const steps = stepsFor(tour, canRef.current);
      if (steps.length === 0) return;
      setActive({ tour, steps, key: Date.now() });
      saveProgress(tour.id, 'in_progress', 0, steps.length, tour.version);
    },
    [saveProgress]
  );

  const disabled = progress[ALL_TOURS_ID]?.status === 'skipped';

  // Автозапуск: «Знакомство», затем тур модуля — когда нет открытых окон и журнал версий закрыт
  React.useEffect(() => {
    if (!loaded || !versionChecked || whatsNew.open || active || disabled) return;
    const can = canRef.current;
    const welcome = tourById('welcome');
    const moduleTour = tourForPath(pathname);
    const candidate =
      welcome && !isFinished(progress.welcome)
        ? welcome
        : moduleTour && isTourAvailable(moduleTour, can) && !isFinished(progress[moduleTour.id])
        ? moduleTour
        : null;
    if (!candidate) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts++;
      if (isModalOpen()) {
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      window.clearInterval(timer);
      begin(candidate.id);
    }, AUTOSTART_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [loaded, versionChecked, whatsNew.open, active, disabled, pathname, progress, begin]);

  // Переход в другой модуль прерывает тур модуля (он предложится снова при следующем открытии)
  const activeRoute = active?.tour.route;
  React.useEffect(() => {
    if (!activeRoute || activeRoute === '*') return;
    const stillHere = activeRoute === '/' ? pathname === '/' : pathname.startsWith(activeRoute);
    if (!stillHere) setActive(null);
  }, [pathname, activeRoute]);

  const handleComplete = React.useCallback(
    (stepsSeen: number, total: number) => {
      if (active) saveProgress(active.tour.id, 'completed', stepsSeen, total, active.tour.version);
      setActive(null);
    },
    [active, saveProgress]
  );

  const handleSkip = React.useCallback(
    (stepsSeen: number, total: number, disableAll: boolean) => {
      if (active) saveProgress(active.tour.id, 'skipped', stepsSeen, total, active.tour.version);
      if (disableAll) saveProgress(ALL_TOURS_ID, 'skipped', 0, 0);
      setActive(null);
    },
    [active, saveProgress]
  );

  const startTour = React.useCallback(
    (tourId: string) => {
      if (active) return;
      // Справка закрывается первой — тур стартует, когда окно уже исчезло
      window.setTimeout(() => begin(tourId), 250);
    },
    [active, begin]
  );

  const setDisabled = React.useCallback(
    (value: boolean) => saveProgress(ALL_TOURS_ID, value ? 'skipped' : 'in_progress', 0, 0),
    [saveProgress]
  );

  const currentTour = React.useMemo(() => {
    const tour = tourForPath(pathname);
    return tour && isTourAvailable(tour, user.can) ? tour : null;
  }, [pathname, user.can]);

  const value = React.useMemo<GuideContextValue>(
    () => ({
      currentTour,
      startTour,
      openWhatsNew: () => setWhatsNew({ open: true }),
      hasUnseenVersion,
      disabled,
      setDisabled,
      progress,
    }),
    [currentTour, startTour, hasUnseenVersion, disabled, setDisabled, progress]
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          key={active.key}
          tour={active.tour}
          steps={active.steps}
          onComplete={handleComplete}
          onSkip={handleSkip}
        />
      )}
      <WhatsNewModal open={whatsNew.open} onClose={closeWhatsNew} entries={whatsNew.entries} />
    </GuideContext.Provider>
  );
}
