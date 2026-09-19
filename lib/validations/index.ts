import { z } from 'zod';

export const PayoutSchema = z.object({
  user_id: z.string().uuid('Некорректный идентификатор сотрудника'),
  accrual_month: z.string().regex(/^\d{4}-\d{2}$/, 'Период начисления должен быть в формате ГГГГ-ММ'),
  payout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата выплаты должна быть в формате ГГГГ-ММ-ДД'),
  amount: z.coerce.number().positive('Сумма выплаты должна быть больше нуля'),
  payout_category: z.enum(['аванс', 'выплата зп', 'бонус', 'прочие начисления', 'удержание'], {
    message: 'Недопустимая категория выплаты',
  }),
  payment_method: z.string().min(1, 'Укажите способ проведения выплаты'),
  comment: z.string().optional().nullable(),
});

export const EmployeeRateSchema = z.object({
  user_id: z.string().uuid('Некорректный идентификатор сотрудника'),
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

export const LeadCreateSchema = z.object({
  client_name: z.string().min(2, 'Имя должно содержать не менее 2 символов'),
  phone: z.string().min(6, 'Укажите корректный номер телефона'),
  country_code: z.string().default('996').optional(),
  instagram: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  assigned_to: z
    .preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
      z.string().uuid('Некорректный идентификатор ответственного').nullable().optional()
    ),
});

