import { cn, formatMoney } from '@/lib/utils';
import type { Product } from '@/lib/types';

/**
 * Polaris-style product tile for the POS grid.
 * White surface, 1px border, 14px radius; hover deepens the border (no
 * shadow — Calm Surface), tap scales to 0.97 (touch-first). Image with
 * fallback placeholder, 2-line clamped name, bold tabular-nums indigo
 * price (POS mockup). Whole card is a <button> (min 44px) so it works
 * on touch and keyboard.
 */
export function ProductCard({
  product,
  currency,
  onSelect,
  className,
}: {
  product: Product;
  currency: string;
  onSelect: (p: Product) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      data-pos-card
      aria-label={`${product.name} — ${formatMoney(Number(product.price), currency)}`}
      className={cn(
        'group flex w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] text-start',
        'transition-[transform,border-color] duration-150 will-change-transform',
        'hover:border-[var(--color-border-strong)]',
        'active:scale-[0.97]',
        'min-h-[44px]',
        className
      )}
    >
      {product.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.image_url}
          alt=""
          loading="lazy"
          className="aspect-[4/3] w-full shrink-0 bg-[var(--color-surface-sunken)] object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <p
          data-pos-name
          className="line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-5 text-[var(--color-text)]"
        >
          {product.name}
        </p>
        <p
          data-pos-price
          className="mt-auto text-[13px] font-bold tabular-nums text-[var(--color-primary)]"
        >
          {formatMoney(Number(product.price), currency)}
        </p>
      </div>
    </button>
  );
}
