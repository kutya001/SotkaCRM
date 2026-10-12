import type { UserRole } from '@/types/database.types';

/** Названия ролей для интерфейса */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  supervisor: 'Руководитель',
  consultant: 'Консультант',
  smm: 'SMM-специалист',
};
