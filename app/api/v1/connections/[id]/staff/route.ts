import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { assignConnectionStaff } from '@/lib/services/connections';

const StaffSchema = z.object({
  manager_id: z.string().uuid().nullable().optional(),
  maintenance: z
    .array(
      z.object({
        month_index: z.number().int().min(1).max(24),
        user_id: z.string().uuid().nullable(),
      })
    )
    .max(24)
    .optional(),
});

/**
 * PATCH /api/v1/connections/[id]/staff — сотрудники подключения (042):
 * { manager_id?: uuid, maintenance?: [{ month_index, user_id | null }] }
 * manager_id — подключивший (назначение подтверждает подключение, право connections.confirm);
 * maintenance — сопровождающие по месяцам (подтверждаются при начислении).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('connections.edit');
    const body = await req.json().catch(() => ({}));
    const parsed = StaffSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }
    if (parsed.data.manager_id && !ctx.can('connections.confirm')) {
      return apiError('Назначение подключившего подтверждает подключение: требуется право подтверждать подключения', 'FORBIDDEN', 403);
    }

    const res = await assignConnectionStaff({
      connectionId: id,
      managerId: parsed.data.manager_id ?? undefined,
      maintenance: parsed.data.maintenance,
      actor: ctx.profile,
    });
    if (!res.success) return apiError(res.error, res.code, res.status);
    return apiSuccess(res);
  } catch (err) {
    return handleApiError(err);
  }
}
