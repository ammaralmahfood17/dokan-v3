import { Skeleton } from '@/components/ui/skeleton';

// FIX-E-002: Loading skeleton موحد للأقسام — نفس tokens (bg-surface-sunken + animate-pulse)
export default function SectionLoading() {
  return (
    <div className="page">
      <div className="mb-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
