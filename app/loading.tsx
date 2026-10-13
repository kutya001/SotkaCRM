import { Loader2 } from 'lucide-react';

// Мгновенный отклик при переходе на динамические маршруты: спиннер внутри области контента,
// оболочка (сайдбар, шапка, нижняя панель) остается на месте
export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-zinc-400" strokeWidth={1.75} />
    </div>
  );
}
