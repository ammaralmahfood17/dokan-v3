import { cn } from '@/lib/utils';

/**
 * Skeleton component for loading states.
 * Usage:
 *   <Skeleton className="h-4 w-40" />   // text line
 *   <Skeleton className="h-10 w-10 rounded-full" />  // avatar
 *   <Skeleton className="h-40 w-full rounded-xl" />   // card
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'skeleton-shimmer rounded-md bg-[var(--color-border)]',
        className
      )}
      {...props}
    />
  );
}

/**
 * Dashboard skeleton — shows instantly while getCurrentProject() resolves.
 * Matches the actual dashboard layout structure for smooth visual transition.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex min-h-dvh bg-[var(--color-bg)]">
      {/* Sidebar skeleton (hidden on mobile) */}
      <div className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-l border-[var(--color-border)] p-4 lg:flex">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-[var(--radius-md)]" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header skeleton */}
        <div className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-[var(--radius-md)]" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>

        {/* Page content skeleton */}
        <div className="flex-1 p-4 pb-20 lg:pb-0">
          {/* Title */}
          <Skeleton className="mb-1 h-7 w-32" />
          <Skeleton className="mb-6 h-4 w-56" />

          {/* Stats cards */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>

          {/* Checklist skeleton */}
          <Skeleton className="mb-3 h-5 w-28" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>

        {/* Mobile nav skeleton */}
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-drawer)] border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:hidden">
          <div className="mx-auto flex max-w-lg items-stretch justify-between px-4 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-10 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * D9: Public menu skeleton — header + category pills + 6 product rows.
 * Same tokens as DashboardSkeleton (bg-surface-sunken + animate-pulse).
 */
export function MenuSkeleton() {
  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-[var(--color-bg)] px-4 pb-24 pt-4">
      {/* Brand header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="h-9 w-9 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)]" />
        <div className="h-6 w-24 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)]" />
      </div>
      {/* Category pills */}
      <div className="mb-5 flex gap-2 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 w-20 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-sunken)]"
          />
        ))}
      </div>
      {/* Product rows */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--color-border)] py-3">
          <div className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)]" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-surface-sunken)]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--color-surface-sunken)]" />
            <div className="h-3 w-16 animate-pulse rounded bg-[var(--color-surface-sunken)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
