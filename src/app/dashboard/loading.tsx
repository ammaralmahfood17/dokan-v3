import { DashboardSkeleton } from '@/components/ui/skeleton';

/**
 * Instant loading skeleton for the entire dashboard.
 * Rendered by Next.js immediately while getCurrentProject() resolves.
 * No async — pure JSX, so it appears in under 1ms.
 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
