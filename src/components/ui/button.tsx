// FIX-C-004/C-005: forwardRef + asChild (polymorphism) — Button يقدّم نفسه
// كـ <button> أو أي عنصر (a/Next Link) مع الاحتفاظ بالـ ref.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** FIX-C-005: عرض <button> كعنصر آخر (مثل next/link) — Slot مبسط بلا Radix */
  asChild?: boolean;
  /** FIX-C-004/D12: سبينر مدمج + تعطيل تلقائي (يمنع النقر المزدوج) */
  isLoading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const sizeClass: Record<Size, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

/** Slot مبسط: يدمج props مع أول عنصر child (نمط Radix Slot بدون الاعتماد) */
function Slot({ children, ...props }: { children: ReactNode } & Record<string, unknown>) {
  const child = (Array.isArray(children) ? children[0] : children) as
    | (React.ReactElement & { props: Record<string, unknown> })
    | undefined;
  if (!child) return null;
  return (
    <child.type
      {...child.props}
      {...props}
      className={cn(child.props.className as string, props.className as string)}
    />
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      block,
      asChild,
      isLoading,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const cls = cn(
      'btn',
      variantClass[variant],
      sizeClass[size],
      block && 'btn-block',
      className
    );

    if (asChild) {
      return (
        <Slot
          className={cls}
          aria-busy={isLoading || undefined}
          disabled={disabled || isLoading}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={cls}
        {...props}
      >
        {isLoading && (
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:hidden"
          />
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
