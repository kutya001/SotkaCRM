import { Loader2 } from 'lucide-react';

// Мгновенный отклик при переходе на динамические маршруты (например, /docs),
// пока сервер готовит страницу
export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950">
      <Loader2 className="w-6 h-6 animate-spin text-zinc-400" strokeWidth={1.75} />
    </div>
  );
}
