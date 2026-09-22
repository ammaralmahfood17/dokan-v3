'use client';

// FIX-C-003 (audit 2.4): useCategoryCrud — extracted verbatim from
// products-client.tsx. Category create/edit/delete state + mutations; the
// returned values feed the already-extracted CategoryManager modals.
// No behavior change.
import { Dispatch, FormEvent, SetStateAction, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { revalidateMenuCache } from '@/lib/products-utils';
import type { Category } from '@/lib/types';
import { toast } from 'sonner';

export function useCategoryCrud({
  projectId,
  categories,
  setCategories,
}: {
  projectId: string;
  categories: Category[];
  setCategories: Dispatch<SetStateAction<Category[]>>;
}) {
  // Category form
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState('');
  const [loading, setLoading] = useState(false);

  // Edit category
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<Category | null>(null);

  // Fresh category form every time — never leak the previous draft or error
  // into a newly opened modal (cancel/X/backdrop close without resetting).
  function openCategoryForm() {
    setCatName('');
    setCatError('');
    setShowCategoryForm(true);
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

  return {
    showCategoryForm,
    setShowCategoryForm,
    catName,
    setCatName,
    catError,
    setCatError,
    loading,
    editingCat,
    setEditingCat,
    editCatName,
    setEditCatName,
    confirmDeleteCat,
    setConfirmDeleteCat,
    openCategoryForm,
    saveCategory,
    updateCategory,
    deleteCategory,
  };
}
