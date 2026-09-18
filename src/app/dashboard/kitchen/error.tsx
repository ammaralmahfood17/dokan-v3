'use client';

// FIX-E-001: Error boundary موحد لكل قسم (نمط dashboard/error.tsx المبسط)
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle className="h-12 w-12 text-[var(--color-danger)]" />
      <h2 className="text-lg font-semibold">حدث خطأ في هذه الصفحة</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">يرجى المحاولة مرة أخرى</p>
      <button onClick={reset} className="btn btn-primary">
        <RefreshCw className="h-4 w-4" />
        إعادة المحاولة
      </button>
    </div>
  );
}
