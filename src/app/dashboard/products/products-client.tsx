'use client';

import { FormEvent, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Plus, Pencil, Trash2, X, ImageIcon, Check, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { Toggle } from '@/components/ui/toggle';
import type { Category, Product, ProductAddon } from '@/lib/types';
import type { Database } from '@/lib/database.types';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type ProductWithAddons = Product & { product_addons: ProductAddon[] };

/**
 * M5: after any product/category mutation, purge the public menu cache for
 * this project so the live QR menu reflects the change immediately instead of
 * after the 60s ISR window. Fire-and-forget — cache purge must never block or
 * fail the user's action. The endpoint re-checks membership server-side.
 */
// FIX-C-001: helpers مستخرجة (validate/remove/compress)
import { validateProduct, removeProductImage, compressImage, type FieldErrors } from '@/lib/products-utils';
// FIX-C-001: مكوّن رفع الصور مستخرج
import { ImageUploader } from '@/components/dashboard/products/image-uploader';
// FIX-C-001: نموذج المنتج مستخرج
import { ProductFormModal } from '@/components/dashboard/products/product-form-modal';
// FIX-C-001: modals التصنيفات مستخرجة
import { CategoryManager } from '@/components/dashboard/products/category-manager';

function revalidateMenuCache(projectId: string) {
  void fetch('/api/revalidate-menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  }).catch(() => {});
}

/** Temporary addon line in the product form — id is set for existing (persisted) addons */
type FormAddon = { key: string; id?: string; name: string; price: string };

/** Best-effort: delete the storage object behind a product image URL (ignore failures) */
export function ProductsClient({
  projectId,
  currency,
  initialCategories,
  initialProducts,
}: {
  projectId: string;
  currency: string;
  initialCategories: Category[];
  initialProducts: ProductWithAddons[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editing, setEditing] = useState<ProductWithAddons | null>(null);
  const [loading, setLoading] = useState(false);


  // Category form
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState('');

  // Edit category
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<Category | null>(null);

  // Search + category filter
  const [searchQuery, setSearchQuery] = useState('');
  // FIX-P-002: تأجيل الفلترة — لا تحجب الـ main thread أثناء الكتابة
  const deferredSearch = useDeferredValue(searchQuery);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.sort_order - b.sort_order),
    [products]
  );

  const filteredProducts = useMemo(() => {
    let list = sortedProducts;
    if (activeCat) {
      list = list.filter((p) => p.category_id === activeCat);
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.name_en ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sortedProducts, activeCat, deferredSearch]);

  // Live product counts per category (updates as products change).
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of sortedProducts) {
      if (!p.category_id) continue;
      counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    }
    return counts;
  }, [sortedProducts]);

  function openCreate() {
    // FIX-C-001: النموذج يهيئ حالته من editing (null = جديد)
    setEditing(null);
    setShowProductForm(true);
  }

  // Fresh category form every time — never leak the previous draft or error
  // into a newly opened modal (cancel/X/backdrop close without resetting).
  function openCategoryForm() {
    setCatName('');
    setCatError('');
    setShowCategoryForm(true);
  }

  function openEdit(p: ProductWithAddons) {
    // FIX-C-001: النموذج يهيئ حالته من editing
    setEditing(p);
    setShowProductForm(true);
  }

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<ProductWithAddons | null>(null);

  async function deleteProduct(id: string) {
    const supabase = createClient();
    const product = products.find((p) => p.id === id);
    const { error } = await supabase.from('products').delete().eq('id', id).eq('project_id', projectId);
    if (error) {
      toast.error('فشل الحذف');
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast.success('تم حذف المنتج');
    removeProductImage(product?.image_url);
    revalidateMenuCache(projectId);
  }

  async function deleteAddon(productId: string, addonId: string) {
    const supabase = createClient();
    // Verify the product belongs to this project before touching its addons
    const { data: owned } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!owned) {
      toast.error('لا يمكن حذف هذه الإضافة');
      return;
    }
    const { error } = await supabase.from('product_addons').delete().eq('product_id', productId).eq('id', addonId);
    if (error) {
      toast.error('فشل الحذف');
      return;
    }
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? { ...p, product_addons: p.product_addons.filter((a) => a.id !== addonId) }
          : p
      )
    );
  }

  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  function exitBulk() {
    setBulkMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = filteredProducts.map((p) => p.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  async function bulkSetAvailability(available: boolean) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('products')
        .update({ is_available: available })
        .in('id', [...selectedIds])
        .eq('project_id', projectId);
      if (error) {
        toast.error('فشل التحديث');
        return;
      }
      setProducts((prev) =>
        prev.map((p) =>
          selectedIds.has(p.id) ? { ...p, is_available: available } : p
        )
      );
      toast.success(available ? 'تم تفعيل المنتجات' : 'تم إيقاف المنتجات');
      exitBulk();
      revalidateMenuCache(projectId);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', [...selectedIds])
        .eq('project_id', projectId);
      setConfirmBulkDelete(false);
      if (error) {
        toast.error('فشل الحذف');
        return;
      }
      setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      toast.success('تم حذف المنتجات');
      exitBulk();
      revalidateMenuCache(projectId);
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveCategory(e: FormEvent) {
    e.preventDefault();
    if (!catName.trim()) {
      setCatError('اسم التصنيف مطلوب');
      return;
    }
    setCatError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('categories')
        .insert({
          project_id: projectId,
          name: catName.trim(),
          sort_order: categories.length,
        })
        .select('*')
        .single();
      if (error || !data) {
        toast.error('فشل إنشاء التصنيف');
        return;
      }
    setCategories((prev) => [...prev, data as Category]);
    setCatName('');
    setShowCategoryForm(false);
    toast.success('تم إنشاء التصنيف');
    revalidateMenuCache(projectId);
    } finally {
      setLoading(false);
    }
  }

  async function updateCategory() {
    const name = editCatName.trim();
    if (!name || !editingCat) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('categories')
        .update({ name })
        .eq('id', editingCat.id)
        .eq('project_id', projectId);
      if (error) { toast.error('فشل التحديث'); return; }
      setCategories((prev) => prev.map((c) => c.id === editingCat.id ? { ...c, name } : c));
      setEditingCat(null);
      toast.success('تم تحديث التصنيف');
      revalidateMenuCache(projectId);
    } finally {
      setLoading(false);
    }
  }

  async function deleteCategory() {
    if (!confirmDeleteCat) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('categories').delete().eq('id', confirmDeleteCat.id).eq('project_id', projectId);
      if (error) { toast.error('فشل الحذف — تأكد من عدم وجود منتجات مرتبطة'); return; }
      setCategories((prev) => prev.filter((c) => c.id !== confirmDeleteCat.id));
      toast.success('تم حذف التصنيف');
      revalidateMenuCache(projectId);
    } finally {
      setLoading(false);
    }
  }


  const refresh = useCallback(async () => { router.refresh(); }, [router]);

  return (
    <div className="page">
      <PullToRefresh onRefresh={refresh}>
      <div className="page-header">
        <div>
          <h1>المنتجات</h1>
          <p>إدارة التصنيفات والمنتجات والإضافات</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulkMode ? (
            <>
              <Button variant="secondary" size="sm" onClick={exitBulk}>
                إلغاء التحديد
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                منتج جديد
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setBulkMode(true)}>
                تحديد
              </Button>
              <Button variant="secondary" size="sm" onClick={openCategoryForm}>
                تصنيف جديد
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                منتج جديد
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          className="input ps-10 pe-12"
          placeholder="ابحث عن منتج…"
          maxLength={100}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute end-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm"
            aria-label="مسح البحث"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            aria-pressed={!activeCat}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-xs font-bold transition-all ${
              !activeCat
                ? 'bg-[var(--color-primary)] text-white'
                : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
            }`}
          >
            <span>الكل</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                !activeCat ? 'bg-white/20' : 'bg-[var(--color-bg)]'
              }`}
            >
              {sortedProducts.length}
            </span>
          </button>
          {categories.map((c) => (
            <div
              key={c.id}
              className={`flex min-h-[44px] items-center gap-0.5 rounded-full py-1 pe-1 ps-3 text-xs font-bold transition-all ${
                activeCat === c.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveCat(activeCat === c.id ? null : c.id)}
                aria-pressed={activeCat === c.id}
                className="flex items-center gap-1.5 rounded-full py-1.5"
              >
                {c.name}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                    activeCat === c.id ? 'bg-white/20' : 'bg-[var(--color-bg)]'
                  }`}
                >
                  {categoryCounts.get(c.id) ?? 0}
                </span>
              </button>
              {/* Edit/delete — real buttons, always visible (touch + keyboard) */}
              <span className="mx-0.5 h-4 w-px bg-[var(--color-border)]" aria-hidden="true" />
              <button
                type="button"
                onClick={() => { setEditingCat(c); setEditCatName(c.name); }}
                aria-label={`تعديل التصنيف ${c.name}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-opacity hover:opacity-70"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteCat(c)}
                aria-label={`حذف التصنيف ${c.name}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-opacity hover:opacity-70"
              >
                <Trash2 className="h-3 w-3 text-[var(--color-danger)]" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!filteredProducts.length ? (
        <EmptyState
          title={searchQuery || activeCat ? 'لا توجد نتائج' : 'ما فيه منتجات حالياً'}
          description={searchQuery || activeCat ? 'جرب تغيير كلمات البحث أو إلغاء الفلتر.' : 'أضف أول منتج وبيّن للعملاء قائمتك.'}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              أضف أول منتج
            </Button>
          }
        />
      ) : (
        <>
          {/* FIX-P-003: containment لعزل الشبكة الثقيلة */}
          <div className="product-grid grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                role={bulkMode ? undefined : 'button'}
                tabIndex={bulkMode ? undefined : 0}
                onClick={bulkMode ? undefined : () => openEdit(p)}
                onKeyDown={
                  bulkMode
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openEdit(p);
                        }
                      }
                }
                aria-label={bulkMode ? undefined : `تعديل ${p.name}`}
                className={`dashboard-card card overflow-hidden text-start transition-all active:scale-[0.98] ${
                  bulkMode && selectedIds.has(p.id) ? 'ring-2 ring-[var(--color-primary)]' : ''
                } ${!p.is_available ? 'opacity-60' : ''}`}
              >
                {/* Image / placeholder — 4:3 like the POS grid. surface so no-image
                    cards read as one clean card instead of bleeding into the page bg */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-surface)]">
                  {p.image_url ? (
                    <Image
                      src={p.image_url}
                      alt={p.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 200px"
                      className={`object-cover ${
                        !p.is_available ? 'grayscale' : ''
                      }`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
                      <ImageIcon className="h-7 w-7" />
                    </div>
                  )}
                  {bulkMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelect(p.id)}
                      aria-label={`اختيار ${p.name}`}
                      className={`absolute start-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border-2 bg-[var(--color-surface)] transition-colors ${
                        selectedIds.has(p.id)
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-[var(--color-border)] text-transparent'
                      }`}
                    >
                      <Check className="h-5 w-5" />
                    </button>
                  ) : (
                    !p.is_available && (
                      <span className="absolute end-2 top-2 rounded-[4px] bg-[var(--color-danger)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-surface)]">
                        متوقف
                      </span>
                    )
                  )}
                </div>

                <div className="p-3">
                  <h3 className="line-clamp-1 text-sm font-bold">{p.name}</h3>
                  {p.description && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-text-secondary)]">
                      {p.description}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-bold tabular-nums text-[var(--color-text)]">
                    {formatMoney(Number(p.price), currency)}
                  </p>

                  {p.product_addons?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.product_addons.slice(0, 2).map((a) => (
                        <span
                          key={a.id}
                          className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]"
                        >
                          {a.name}
                        </span>
                      ))}
                      {p.product_addons.length > 2 && (
                        <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--color-primary)]">
                          +{p.product_addons.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Bulk action bar */}
          {bulkMode && (
            <div className="sticky bottom-3 z-[var(--z-sticky)] mt-4 flex items-center justify-between gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-float">
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                className="flex min-h-[44px] items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-semibold text-[var(--color-text-secondary)]"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
                    allVisibleSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  {allVisibleSelected && <Check className="h-3 w-3" />}
                </span>
                {allVisibleSelected ? 'إلغاء الكل' : 'اختيار الكل'}
              </button>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => bulkSetAvailability(true)}
                  disabled={bulkBusy || selectedIds.size === 0}
                  className="btn btn-secondary btn-sm"
                >
                  تفعيل
                </button>
                <button
                  type="button"
                  onClick={() => bulkSetAvailability(false)}
                  disabled={bulkBusy || selectedIds.size === 0}
                  className="btn btn-secondary btn-sm"
                >
                  إيقاف
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={bulkBusy || selectedIds.size === 0}
                  className="btn btn-danger btn-sm"
                >
                  حذف
                </button>
              </div>
            </div>
          )}
        </>
      )}

      </PullToRefresh>

      {/* ======== PRODUCT FORM MODAL — FIX-C-001: extracted component ======== */}
      {showProductForm && (
        <ProductFormModal
          projectId={projectId}
          currency={currency}
          categories={categories}
          products={products}
          editing={editing}
          onClose={() => setShowProductForm(false)}
          onSaved={(product, editingId) => {
            // FIX-C-001: تحديث القائمة من النموذج المستخرج
            setProducts((prev) =>
              editingId
                ? prev.map((p) => (p.id === editingId ? product : p))
                : [...prev, product]
            );
          }}
          onRequestDelete={(p) => {
            setShowProductForm(false);
            setConfirmDelete(p);
          }}
        />
      )}

      {/* ======== CATEGORY MODALS — FIX-C-001: extracted component ======== */}
      <CategoryManager
        showCategoryForm={showCategoryForm}
        catName={catName}
        setCatName={setCatName}
        catError={catError}
        setCatError={setCatError}
        saveCategory={saveCategory}
        loading={loading}
        onCloseCreate={() => setShowCategoryForm(false)}
        editingCat={editingCat}
        editCatName={editCatName}
        setEditCatName={setEditCatName}
        updateCategory={updateCategory}
        onCloseEdit={() => setEditingCat(null)}
        confirmDeleteCat={confirmDeleteCat}
        deleteCategory={deleteCategory}
        onCloseDelete={() => setConfirmDeleteCat(null)}
      />

      {confirmBulkDelete && (
        <Modal title="حذف المنتجات المحددة" onClose={() => setConfirmBulkDelete(false)}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-tint)]">
              <Trash2 className="h-6 w-6 text-[var(--color-danger)]" />
            </div>
            <p className="mb-5 text-xs text-[var(--color-text-secondary)]">
              هل أنت متأكد؟ هذا الإجراء لا يمكن التراجع عنه.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                block
                disabled={bulkBusy}
                onClick={bulkDelete}
              >
                {bulkBusy ? 'جاري…' : 'نعم، احذف'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmBulkDelete(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
