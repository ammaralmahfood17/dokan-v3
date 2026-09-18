// D1: Top products (by revenue) — extracted from dashboard/page.tsx.
import Link from 'next/link';
import { formatMoney } from '@/lib/utils';
import type { WeekTopStat } from '@/lib/dashboard-data';

export function TopProducts({
  top3,
  currency,
}: {
  top3: [string, WeekTopStat][];
  currency: string;
}) {
  return (
    <div className="card card-body">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[14.5px] font-bold">الأكثر مبيعًا هذا الأسبوع</h2>
        <Link
          href="/dashboard/analytics"
          className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)]"
        >
          التفاصيل
        </Link>
      </div>
      {top3.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          ما فيه منتجات مباعة هالأسبوع.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {top3.map(([name, stat], idx) => (
            <li key={name} className="flex items-center gap-3 text-xs">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-tint)] font-bold text-[var(--color-primary)]">
                {idx + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
              <span className="shrink-0 text-[var(--color-text-secondary)]">
                {stat.qty} قطعة
              </span>
              <span className="w-16 shrink-0 text-end font-bold tabular-nums text-[var(--color-text)]" dir="ltr">
                {formatMoney(stat.revenue, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
