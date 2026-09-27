import { z } from 'zod';

export const PG_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const paymentMethodSchema = z.enum(['mbank', 'odengi', 'bakai', 'abank', 'cash'], {
  message: 'Недопустимый метод оплаты (кошелек)',
});

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  mbank: 'МБанк',
  odengi: 'О!Деньги',
  bakai: 'Бакай Банк',
  abank: 'АБанк',
  cash: 'Наличка',
};

export const salaryOperationSignSchema = z.enum(['+', '-']);
export type SalaryOperationSign = z.infer<typeof salaryOperationSignSchema>;

export const salaryOperationTypeSchema = z.enum([
  'accrual_connection',
  'accrual_maintenance',
  'salary_base',
  'bonus_other',
  'deduction',
  'fine',
  'payout',
]);
export type SalaryOperationType = z.infer<typeof salaryOperationTypeSchema>;

export const SALARY_OPERATION_TYPE_LABELS: Record<SalaryOperationType, string> = {
  accrual_connection: 'Начисление по подключению',
  accrual_maintenance: 'Начисление по сопровождению',
  salary_base: 'Оклад',
  bonus_other: 'Прочая надбавка',
  deduction: 'Удержание',
  fine: 'Штраф',
  payout: 'Выплата',
};

export const PayoutSchema = z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника'),
  employee_id: z.string().regex(PG_UUID_REGEX).optional().nullable(),
  accrual_month: z.string().regex(/^\d{4}-\d{2}$/, 'Период начисления должен быть в формате ГГГГ-ММ').optional(),
  settlement_month: z.string().regex(/^\d{4}-\d{2}$/, 'Расчетный месяц должен быть в формате ГГГГ-ММ').optional().nullable(),
  payout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата выплаты должна быть в формате ГГГГ-ММ-ДД').optional(),
  actual_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата операции должна быть в формате ГГГГ-ММ-ДД').optional(),
  amount: z.coerce.number().positive('Сумма операции должна быть больше нуля'),
  operation_sign: salaryOperationSignSchema.optional(),
  operation_type: salaryOperationTypeSchema.optional().default('payout'),
  payout_category: z.enum(['аванс', 'выплата зп', 'бонус', 'прочие начисления', 'удержание']).optional(),
  payment_method: paymentMethodSchema.optional().nullable(),
  comment: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  connection_id: z.string().regex(PG_UUID_REGEX).optional().nullable(),
  seller_phone: z.string().optional().nullable(),
  accrual_ids: z.array(z.string().regex(PG_UUID_REGEX)).optional().nullable(),
});

export const LeadStatusSchema = z.enum(['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'], {
  message: 'Недопустимый статус лида',
});

export const LeadsBatchActionSchema = z.object({
  action: z.enum(['change_status', 'change_assigned', 'delete']),
  ids: z.array(z.string().regex(PG_UUID_REGEX)).optional(),
  lead_ids: z.array(z.string().regex(PG_UUID_REGEX)).optional(),
  status: LeadStatusSchema.optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  payload: z.any().optional(),
}).refine((data) => (data.ids && data.ids.length > 0) || (data.lead_ids && data.lead_ids.length > 0), {
  message: 'Необходимо выбрать хотя бы один лид',
});

export const SellersBatchActionSchema = z.object({
  action: z.enum(['change_manager', 'delete']),
  ids: z.array(z.string().min(1)).optional(),
  seller_ids: z.array(z.string().min(1)).optional(),
  manager_id: z.string().uuid().nullable().optional(),
  payload: z.any().optional(),
}).refine((data) => (data.ids && data.ids.length > 0) || (data.seller_ids && data.seller_ids.length > 0), {
  message: 'Необходимо выбрать хотя бы одного продавца',
});

export const EmployeeRateSchema = z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника'),
  connection_percent: z.coerce.number().min(0).max(100, 'Процент подключения должен быть от 0 до 100'),
  maintenance_percent: z.coerce.number().min(0).max(100, 'Процент сопровождения должен быть от 0 до 100'),
  effective_from: z.string().regex(/^\d{4}-\d{2}$/, 'Период действия должен быть в формате ГГГГ-ММ'),
});

export const PlanUpdateSchema = z.object({
  plan_name: z.string().min(1, 'Укажите название тарифа'),
  price: z.coerce.number().min(0, 'Стоимость не может быть отрицательной'),
  billing_period: z.string().min(1, 'Укажите расчетный период'),
  description: z.string().nullable().optional(),
  is_active: z.boolean(),
});

/**
 * Приведение идентификаторов внешних ключей к строгому UUID PostgreSQL или null.
 * Whitelist: если строка соответствует формату UUID (32 hex-символа), возвращается строка.
 * Любые иные значения (пустые строки, плейсхолдеры "—", "-", "unassigned", "none", null, undefined)
 * гарантированно преобразуются в null.
 */
export function normalizeNullableUuid(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (PG_UUID_REGEX.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  return null;
}

export const LeadCreateSchema = z.object({
  client_name: z.string().min(2, 'Имя должно содержать не менее 2 символов'),
  phone: z.string().min(6, 'Укажите корректный номер телефона'),
  country_code: z.string().default('996').optional(),
  instagram: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  assigned_to: z
    .preprocess(
      (val) => normalizeNullableUuid(val),
      z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор ответственного').nullable().optional()
    )
    .default(null),
});

/**
 * Валидация произвольного HEX-кода цвета (#RGB или #RRGGBB)
 */
export const HexColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Некорректный HEX-код цвета')
  .nullable()
  .optional();

export const employeeSchema = z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника').optional(),
  login: z.string().min(3, 'Логин должен содержать не менее 3 символов'),
  full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа'),
  phone: z.string().nullable().optional(),
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }),
  is_active: z.boolean().default(true),
  color: HexColorSchema,
});

export const createEmployeeSchema = z.object({
  login: z.string().min(3, 'Логин должен содержать не менее 3 символов'),
  password: z.string().min(6, 'Пароль должен содержать минимум 6 символов'),
  full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа'),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }),
  color: HexColorSchema,
});

export const updateEmployeeSchema = z.object({
  full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа').optional(),
  phone: z.string().nullable().optional(),
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }).optional(),
  is_active: z.boolean().optional(),
  color: HexColorSchema,
});

export const LeadUpdateSchema = z.object({
  client_name: z.string().min(2, 'Имя должно содержать не менее 2 символов').optional(),
  phone: z.string().min(6, 'Укажите корректный номер телефона').optional(),
  country_code: z.string().optional(),
  instagram: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  assigned_to: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор ответственного').nullable().optional(),
});


