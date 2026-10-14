import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { assignConnectionStaff, participantIdsOf } from '@/lib/services/connections';

const StaffSchema = z.object({
  /** Полный состав участников: первый — основной (подключивший) */
  participants: z.array(z.string().uuid()).min(1).max(3).optional(),
  maintenance: z
    .array(
      z.object({
        month_index: z.number().int().min(1).max(24),
        /** Пустой список — сопровождают все участники */
        user_ids: z.array(z.string().uuid()).max(3),
      })
    )
    .max(24)
    .optional(),
});

/**
 * PATCH /api/v1/connections/[id]/staff — сотрудники подключения (042/043):
 * { participants?: uuid[], maintenance?: [{ month_index, user_ids }] }
 * Администратор (connections.edit): любой состав; назначение участников подтверждает подключение
 * (нужно connections.confirm). Участник подключения: может только исключать (себя или коллег)
 * из участников и из сопровождения месяца.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('connections.menu');
    const body = await req.json().catch(() => ({}));
    const parsed = StaffSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }

    const canEdit = ctx.can('connections.edit');
    let mode: 'admin' | 'participant' = 'admin';
    if (!canEdit) {
      const participants = await participantIdsOf(id);
      if (!participants.includes(ctx.profile.user_id)) {
        return apiError('Изменять состав могут администратор или участники этого подключения', 'FORBIDDEN', 403);
      }
      mode = 'participant';
    } else if (parsed.data.participants && !ctx.can('connections.confirm')) {
      return apiError('Назначение участников подтверждает подключение: требуется право подтверждать подключения', 'FORBIDDEN', 403);
    }

    const res = await assignConnectionStaff({
      connectionId: id,
      participants: parsed.data.participants,
      maintenance: parsed.data.maintenance,
      actor: ctx.profile,
      mode,
    });
    if (!res.success) return apiError(res.error, res.code, res.status);
    return apiSuccess(res);
  } catch (err) {
    return handleApiError(err);
  }
}
