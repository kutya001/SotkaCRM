/**
 * Причины отмены лида списком (миграция 051, колонка leads.cancel_reason_code).
 * Текст leads.cancel_reason собирается из названия причины и комментария: «Дорого: сказал, подумает».
 * Для «Другое» комментарий обязателен. Файл чистый (без импортов): используется в API, интерфейсе и проверках.
 */

export interface CancelReason {
  code: string;
  label: string;
  hint?: string;
  /** Комментарий обязателен */
  commentRequired?: boolean;
}

export const CANCEL_REASONS: CancelReason[] = [
  { code: 'no_legal_entity', label: 'Нет ИП или ОсОО', hint: 'Не оформлен официально — зарегистрироваться не может' },
  { code: 'too_expensive', label: 'Дорого' },
  { code: 'has_software', label: 'Уже есть программа' },
  { code: 'no_answer', label: 'Не отвечает', hint: 'Несколько попыток без ответа' },
  { code: 'not_target', label: 'Не целевой', hint: 'Не магазин, ошибся номером, спам' },
  { code: 'other', label: 'Другое', commentRequired: true },
];

export const CANCEL_REASON_CODES: string[] = CANCEL_REASONS.map((r) => r.code);

export function cancelReasonByCode(code: string | null | undefined): CancelReason | null {
  return CANCEL_REASONS.find((r) => r.code === code) || null;
}

/** Название причины для отчетов: старые отмены без кода — «Не указана» */
export function cancelReasonLabel(code: string | null | undefined): string {
  return cancelReasonByCode(code)?.label || 'Не указана';
}

export type CancelReasonResult = { ok: true; code: string; text: string } | { ok: false; message: string };

/**
 * Проверка и сборка причины: код из списка, комментарий (для «Другое» — не короче 3 символов).
 * Без кода принимается старый формат — свободный текст не короче 3 символов (код «other»).
 */
export function buildCancelReason(code: string | null | undefined, comment: string | null | undefined): CancelReasonResult {
  const note = (comment || '').trim().replace(/\s+/g, ' ');
  if (note.length > 500) return { ok: false, message: 'Комментарий к причине отмены не длиннее 500 символов' };
  if (!code) {
    if (note.length < 3) return { ok: false, message: 'Выберите причину отмены' };
    return { ok: true, code: 'other', text: note };
  }
  const reason = cancelReasonByCode(code);
  if (!reason) return { ok: false, message: 'Неизвестная причина отмены' };
  if (reason.commentRequired && note.length < 3) {
    return { ok: false, message: `Для причины «${reason.label}» опишите ее (не менее 3 символов)` };
  }
  return { ok: true, code: reason.code, text: note ? `${reason.label}: ${note}` : reason.label };
}
