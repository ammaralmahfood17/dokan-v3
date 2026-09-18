import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type POSBadgeVariant = 'success' | 'critical' | 'neutral';

/**
 * Polaris-style pill badge (20px radius).
 * success = success-tint bg, critical = danger-tint bg, neutral = sunken.
 * neutral = subdued on surface-sunken.
 */
export function POSBadge({
  variant = 'neutral',
  className,
  children,
}: {
  variant?: POSBadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-5',
        variant === 'success' &&
          'bg-[var(--color-success-tint)] text-[var(--color-success)]',
        variant === 'critical' &&
          'bg-[var(--color-danger-tint)] text-[var(--color-danger)]',
        variant === 'neutral' &&
          'bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]',
        className
      )}
    >
      {children}
    </span>
  );
}
