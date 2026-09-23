import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { getPublicProject } from '@/lib/public-project';
import { getSiteUrl } from '@/lib/site-url';
import { createAnonClient } from '@/lib/supabase/anon';

export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}): Promise<Metadata> {
  const { projectSlug } = await params;
  const project = await getPublicProject(projectSlug);
  if (!project) return { title: 'المتجر غير متاح' };

  return {
    title: project.name,
    alternates: {
      canonical: `${getSiteUrl()}/${projectSlug}`,
    },
    openGraph: {
      title: project.name,
      description: `تصفح قائمة ${project.name}`,
    },
  };
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;

  const project = await getPublicProject(projectSlug);
  if (!project) notFound();

  const supabase = createAnonClient();

  // Fetch active tables for this project
  const { data: tables } = await supabase
    .from('tables')
    .select('id, number, slug')
    .eq('project_id', project.id)
    .eq('is_active', true)
    .order('number');

  const activeTables = tables ?? [];

  // ── Rule: 1 active table → redirect straight to its menu ──
  if (activeTables.length === 1) {
    redirect(`/${projectSlug}/menu/${activeTables[0].slug}`);
  }

  const heroColor = project.primary_color || '#4338CA';

  return (
    <main
      dir="rtl"
      className="flex min-h-dvh flex-col bg-[var(--color-bg)]"
    >
      {/* Hero */}
      <div
        className="flex flex-col items-center justify-center px-6 pb-16 pt-20 text-center"
        style={{ background: heroColor, color: '#fff' }}
      >
        {project.logo_url ? (
          <Image
            src={project.logo_url}
            alt={project.name}
            width={64}
            height={64}
            className="mb-4 h-16 w-16 rounded-full border-2 border-white/20 object-cover"
          />
        ) : (
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-2xl font-bold">
            {project.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="mt-2 text-sm text-white/70">قائمة طعام ومشروبات</p>

        <div className="mt-8">
          {activeTables.length > 1 ? (
            /* ── Multiple tables: picker ── */
            <div>
              <p className="mb-3 text-sm font-semibold text-white/80">
                اختر طاولتك
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {activeTables.map((t) => (
                  <Link
                    key={t.id}
                    href={`/${projectSlug}/menu/${t.slug}`}
                    className="inline-flex min-h-[44px] min-w-[72px] items-center justify-center rounded-xl bg-white/15 px-5 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25 active:scale-95"
                  >
                    {t.number}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            /* ── Zero tables: info + note ── */
            <div className="rounded-xl bg-white/10 px-6 py-4 backdrop-blur-sm">
              <p className="text-sm font-semibold text-white">
                مرحباً بك في {project.name}
              </p>
              <p className="mt-1 text-xs text-white/70">
                القائمة غير متاحة حالياً — اسأل الكاشير للمساعدة
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto pb-8 pt-6 text-center">
        <p className="text-[11px] text-[var(--color-text-tertiary)]" dir="ltr">
          Powered by Dokan
        </p>
      </div>
    </main>
  );
}