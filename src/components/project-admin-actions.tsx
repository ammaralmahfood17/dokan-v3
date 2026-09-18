'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/**
 * Phase D — project create / archive / hard-delete for super admins.
 * - Archive = SOFT delete (default): deleted_at set, data retained, reason required.
 * - Hard delete = deliberately separate: type the EXACT project name + reason.
 * Both post to server routes that re-check super-admin membership.
 */

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ownerEmail, slug: slug.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل الإنشاء');
        return;
      }
      toast.success(`تم إنشاء ${data.project.name}`);
      setName('');
      setOwnerEmail('');
      setSlug('');
      router.refresh();
    } catch {
      toast.error('فشل الإنشاء');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card card-body mb-6">
      <h2 className="mb-3 text-sm font-bold">إنشاء متجر لعميل</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          اسم المتجر *
          <input
            className="input h-9"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="مثال: مقهى الخليج"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          إيميل المالك (مسجّل مسبقًا) *
          <input
            className="input h-9"
            dir="ltr"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
            maxLength={120}
            placeholder="owner@example.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          المعرّف (اختياري — يُولّد تلقائيًا)
          <input
            className="input h-9"
            dir="ltr"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={60}
            placeholder="my-store"
          />
        </label>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'جاري الإنشاء…' : 'إنشاء المتجر'}
        </Button>
      </div>
    </form>
  );
}

export function ProjectRowActions({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/archive-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل الأرشفة');
        return;
      }
      toast.success('تمت الأرشفة (البيانات محفوظة)');
      setArchiveOpen(false);
      setReason('');
      router.refresh();
    } catch {
      toast.error('فشل الأرشفة');
    } finally {
      setBusy(false);
    }
  }

  async function hardDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/hard-delete-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, confirmName, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل الحذف');
        return;
      }
      toast.success('تم الحذف النهائي');
      setDeleteOpen(false);
      setReason('');
      setConfirmName('');
      router.refresh();
    } catch {
      toast.error('فشل الحذف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setArchiveOpen(true)}
          className="btn btn-ghost btn-sm text-[var(--color-text-secondary)]"
        >
          أرشفة
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="btn btn-ghost btn-sm text-[var(--color-danger)]"
        >
          حذف نهائي
        </button>
      </div>

      {/* Archive (soft) — reason required */}
      {archiveOpen && (
        <Modal onClose={() => setArchiveOpen(false)} title="أرشفة المتجر">
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              الأرشفة تُغلق المتجر فورًا (لوحة الموظفين + المنيو العام) مع
              <span className="font-bold"> حفظ كل البيانات</span>. يمكن التراجع
              لاحقًا.
            </p>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              السبب (إلزامي)
              <textarea
                className="input min-h-[80px] resize-y py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="مثال: إيقاف الخدمة لعدم الدفع"
              />
            </label>
            <div className="flex gap-2">
              <Button variant="danger" block disabled={busy || !reason.trim()} onClick={archive}>
                {busy ? 'جاري…' : 'تأكيد الأرشفة'}
              </Button>
              <Button variant="secondary" onClick={() => setArchiveOpen(false)}>
                رجوع
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Hard delete — exact name + reason, deliberately separate */}
      {deleteOpen && (
        <Modal onClose={() => setDeleteOpen(false)} title="حذف نهائي — لا رجعة">
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger-tint)] p-3 text-xs leading-relaxed text-[var(--color-danger)]">
              ⚠️ الحذف النهائي <span className="font-bold">يمسح المتجر وكل بياناته</span> من
              القاعدة نهائيًا (الطلبات، المنتجات، الطاولات، الحسابات). هذا إجراء
              تنظيف بيانات، <span className="font-bold">ليس</span> لإيقاف خدمة عادي —
              لذلك استخدم «أرشفة» أولًا.
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              اكتب اسم المتجر بالضبط للتأكيد: <span dir="ltr">{projectName}</span>
              <input
                className="input h-9"
                dir="ltr"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                maxLength={80}
                placeholder={projectName}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              السبب (إلزامي)
              <textarea
                className="input min-h-[80px] resize-y py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="مثال: حذف بيانات تجريبية نهائيًا"
              />
            </label>
            <div className="flex gap-2">
              <Button
                variant="danger"
                block
                disabled={busy || confirmName.trim() !== projectName || !reason.trim()}
                onClick={hardDelete}
              >
                {busy ? 'جاري…' : 'حذف نهائي'}
              </Button>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
                رجوع
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
