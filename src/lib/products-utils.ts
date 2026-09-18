// FIX-C-001: Product helpers — extracted VERBATIM from products-client.tsx.
// Pure logic (validation, image removal, compression) outside the component.
import { createClient } from '@/lib/supabase/client';

/** Per-field validation errors */
export type FieldErrors = {
  name?: string;
  price?: string;
};

export function validateProduct(name: string, price: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!name.trim()) {
    errors.name = 'الاسم مطلوب';
  } else if (name.trim().length < 2) {
    errors.name = 'الاسم يجب أن يكون حرفين على الأقل';
  }
  const parsedPrice = Number(price);
  if (!price.trim()) {
    errors.price = 'السعر مطلوب';
  } else if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
    errors.price = 'السعر غير صالح — أدخل رقماً صحيحاً';
  }
  return errors;
}

/** Best-effort: delete the storage object behind a product image URL (ignore failures) */
export async function removeProductImage(url: string | null | undefined) {
  if (!url) return;
  const marker = '/product-images/';
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length).split('?')[0];
  if (!path) return;
  try {
    const supabase = createClient();
    await supabase.storage.from('product-images').remove([path]);
  } catch {
    // best-effort — an orphaned object is preferable to failing the UI action
  }
}

/** Compress large product images to a WebP thumbnail (≤1024px). */
export async function compressImage(file: File): Promise<File> {
  if (file.size <= 300 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 500 * 1024) return file;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.85)
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
    type: 'image/webp',
  });
}
