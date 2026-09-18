'use client';

// FIX-C-003: Cart sheet — extracted from menu-client.tsx. Renders the
// customer's cart with qty steppers, order notes, total and submit + retry.
import { Minus, Plus } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import type { CartLine } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/menu/sheet';

export function CartSheet({
  open,
  lines,
  currency,
  orderNotes,
  onOrderNotesChange,
  onQty,
  submitting,
  orderError,
  onRetry,
  onPlaceOrder,
  onClose,
}: {
  open: boolean;
  lines: CartLine[];
  currency: string;
  orderNotes: string;
  onOrderNotesChange: (v: string) => void;
  onQty: (key: string, delta: number) => void;
  submitting: boolean;
  orderError: string | null;
  onRetry: () => void;
  onPlaceOrder: () => void;
  onClose: () => void;
}) {
  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  return (
    <Sheet onClose={onClose} title="سلتك">
      <ul className="mb-4 space-y-3">
        {lines.map((l) => (
          <li
            key={l.key}
            className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] pb-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold">{l.productName}</p>
              {l.addons.length > 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  {l.addons.map((a) => a.name).join(' · ')}
                </p>
              )}
              {l.notes && (
                <p className="text-xs text-[var(--color-text-secondary)]">{l.notes}</p>
              )}
              <p className="mt-0.5 text-xs font-semibold tabular-nums">{formatMoney(l.unitPrice, currency)}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="إنقاص الكمية"
                className="min-h-[44px] min-w-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-bold transition-colors hover:bg-[var(--color-bg)]"
                onClick={() => onQty(l.key, -1)}
              >
                <Minus className="mx-auto h-4 w-4" />
              </button>
              <span className="flex w-8 items-center justify-center text-sm font-bold">
                {l.quantity}
              </span>
              <button
                type="button"
                aria-label="زيادة الكمية"
                className="min-h-[44px] min-w-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-bold transition-colors hover:bg-[var(--color-bg)]"
                onClick={() => onQty(l.key, 1)}
              >
                <Plus className="mx-auto h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mb-4">
        <label className="label">ملاحظة للطلب</label>
        <input
          className="input"
          value={orderNotes}
          onChange={(e) => {
            if (e.target.value.length <= 500) onOrderNotesChange(e.target.value);
          }}
          placeholder="مثال: تحساسية من المكسرات"
          maxLength={500}
        />
        <p className="hint">{orderNotes.length}/500</p>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span className="font-semibold">الإجمالي</span>
        <span className="text-base font-bold tabular-nums" dir="ltr">{formatMoney(total, currency)}</span>
      </div>

      <Button
        block
        disabled={submitting || !lines.length}
        onClick={onPlaceOrder}
        style={{ background: 'var(--color-primary)' }}
        className="min-h-[48px]"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:hidden" />
            جاري الإرسال…
          </span>
        ) : (
          'تأكيد الطلب'
        )}
      </Button>

      {/* D10: retry — persistent error with a one-tap retry button */}
      {orderError && (
        <div
          role="alert"
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-center"
        >
          <p className="mb-2 text-[12.5px] font-semibold text-[var(--color-danger)]">
            {orderError}
          </p>
          <Button block size="sm" variant="danger" disabled={submitting} onClick={onRetry}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      <p className="mt-2 text-center text-[11px] text-[var(--color-text-muted)]">
        الأسعار تُحسب من الخادم
      </p>
    </Sheet>
  );
}
