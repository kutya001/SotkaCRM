import { redirect } from 'next/navigation';

/**
 * Модуль персональных процентных ставок перенесен в карточку сотрудника (/employees).
 * Выполняется автоматическая переадресация на /employees.
 */
export default function RatesPage() {
  redirect('/employees');
}
