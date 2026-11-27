/**
 * Прохождение обучения по модулям (миграция 049, туры — lib/onboarding/tours.ts).
 * До применения миграции таблицы нет: чтение отдает пустой список с available = false,
 * запись тихо пропускается — интерфейс хранит прогресс в браузере.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingRelationError } from '@/lib/supabase/missing';
import { hasPermission, legacyPermissionsForRole } from '@/lib/auth/permissions';
import { ALL_TOURS_ID, TOURS, isTourAvailable, stepsFor } from '@/lib/onboarding/tours';
import type { UserRole } from '@/types/database.types';

export type OnboardingStatus = 'in_progress' | 'completed' | 'skipped';

export interface OnboardingProgressRow {
  tour_id: string;
  status: OnboardingStatus;
  steps_seen: number;
  total_steps: number;
  tour_version: number;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

const PROGRESS_COLUMNS = 'tour_id, status, steps_seen, total_steps, tour_version, started_at, finished_at, updated_at';

export const KNOWN_TOUR_IDS: string[] = [ALL_TOURS_ID, ...TOURS.map((t) => t.id)];

/** Прогресс сотрудника по всем турам */
export async function getOnboardingProgress(userId: string): Promise<{ available: boolean; progress: OnboardingProgressRow[] }> {
  const { data, error } = await createAdminClient().from('onboarding_progress').select(PROGRESS_COLUMNS).eq('user_id', userId);
  if (error) {
    if (isMissingRelationError(error)) return { available: false, progress: [] };
    throw error;
  }
  return { available: true, progress: (data || []) as OnboardingProgressRow[] };
}

export interface SaveProgressInput {
  tour_id: string;
  status: OnboardingStatus;
  steps_seen: number;
  total_steps: number;
  tour_version?: number;
}

/** Запись прохождения: начало (in_progress), завершение или пропуск; число шагов только растет */
export async function saveOnboardingProgress(userId: string, input: SaveProgressInput): Promise<{ available: boolean }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await admin
    .from('onboarding_progress')
    .select('steps_seen, started_at, status')
    .eq('user_id', userId)
    .eq('tour_id', input.tour_id)
    .maybeSingle();
  if (readError) {
    if (isMissingRelationError(readError)) return { available: false };
    throw readError;
  }

  const restarted = input.status === 'in_progress';
  const finished = input.status !== 'in_progress';
  const { error } = await admin.from('onboarding_progress').upsert(
    {
      user_id: userId,
      tour_id: input.tour_id,
      status: input.status,
      // Повторное прохождение начинается заново; иначе фиксируем максимум показанных шагов
      steps_seen: restarted ? input.steps_seen : Math.max(input.steps_seen, existing?.steps_seen || 0),
      total_steps: input.total_steps,
      tour_version: input.tour_version ?? 1,
      started_at: restarted || !existing ? now : existing.started_at,
      finished_at: finished ? now : null,
      updated_at: now,
    },
    { onConflict: 'user_id,tour_id' }
  );
  if (error) {
    if (isMissingRelationError(error)) return { available: false };
    throw error;
  }
  return { available: true };
}

export interface TrainingReportTour {
  id: string;
  title: string;
  version: number;
}

export interface TrainingReportCell {
  /** null — тур не нужен роли (модуль недоступен) */
  applicable: boolean;
  status: OnboardingStatus | null;
  steps_seen: number;
  total_steps: number;
  finished_at: string | null;
  updated_at: string | null;
  tour_version: number | null;
}

export interface TrainingReportRow {
  user_id: string;
  full_name: string;
  login: string;
  color: string | null;
  role_name: string;
  /** Сотрудник отключил обучение целиком */
  disabled_all: boolean;
  completed: number;
  applicable: number;
  tours: Record<string, TrainingReportCell>;
}

interface RoleJoin {
  name: string;
  is_admin: boolean;
  role_permissions: { permission: string }[] | null;
}

/** Отчет для администратора: активные сотрудники × туры их роли */
export async function buildTrainingReport(): Promise<{ available: boolean; tours: TrainingReportTour[]; rows: TrainingReportRow[] }> {
  const admin = createAdminClient();
  const { data: users, error: usersError } = await admin
    .from('users')
    .select('user_id, full_name, login, color, role, is_active, roles:role_id(name, is_admin, role_permissions(permission))')
    .eq('is_active', true)
    .order('full_name');
  if (usersError) throw usersError;

  const { data: progress, error } = await admin.from('onboarding_progress').select(`user_id, ${PROGRESS_COLUMNS}`);
  const available = !error;
  if (error && !isMissingRelationError(error)) throw error;

  const byUser = new Map<string, Map<string, OnboardingProgressRow>>();
  for (const p of (progress || []) as (OnboardingProgressRow & { user_id: string })[]) {
    const map = byUser.get(p.user_id) || new Map<string, OnboardingProgressRow>();
    map.set(p.tour_id, p);
    byUser.set(p.user_id, map);
  }

  const tours: TrainingReportTour[] = TOURS.map((t) => ({ id: t.id, title: t.title, version: t.version }));

  const rows: TrainingReportRow[] = (users || []).map((u) => {
    const roleJoin = (u as unknown as { roles: RoleJoin | RoleJoin[] | null }).roles;
    const role = Array.isArray(roleJoin) ? roleJoin[0] || null : roleJoin;
    const permissions = role
      ? role.is_admin
        ? ['*']
        : (role.role_permissions || []).map((p) => p.permission)
      : legacyPermissionsForRole(u.role as UserRole);
    const can = (key: string) => hasPermission(permissions, key);
    const mine = byUser.get(u.user_id) || new Map<string, OnboardingProgressRow>();

    const cells: Record<string, TrainingReportCell> = {};
    let completed = 0;
    let applicableCount = 0;
    for (const tour of TOURS) {
      const applicable = isTourAvailable(tour, can);
      const p = mine.get(tour.id);
      if (applicable) applicableCount++;
      if (applicable && p?.status === 'completed') completed++;
      cells[tour.id] = {
        applicable,
        status: p?.status ?? null,
        steps_seen: p?.steps_seen ?? 0,
        total_steps: p?.total_steps || stepsFor(tour, can).length,
        finished_at: p?.finished_at ?? null,
        updated_at: p?.updated_at ?? null,
        tour_version: p?.tour_version ?? null,
      };
    }

    return {
      user_id: u.user_id,
      full_name: u.full_name,
      login: u.login,
      color: u.color ?? null,
      role_name: role?.name || '—',
      disabled_all: mine.get(ALL_TOURS_ID)?.status === 'skipped',
      completed,
      applicable: applicableCount,
      tours: cells,
    };
  });

  return { available, tours, rows };
}
