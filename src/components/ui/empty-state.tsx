'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'card empty flex flex-col items-center justify-center py-10 text-center',
        className
      )}
    >
      {icon && <div className="mb-4 text-[var(--color-primary)]">{icon}</div>}
      <h3 className="mb-2 text-base font-bold text-[var(--color-text)]">{title}</h3>
      {description && (
        <p className="mb-5 max-w-[260px] text-sm text-[var(--color-text-secondary)]">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
