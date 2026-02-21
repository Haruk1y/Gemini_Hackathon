import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "accent" | "ghost" | "danger";

const variantClasses: Record<Variant, string> = {
  primary: "bg-[var(--pmb-yellow)] text-[var(--pmb-ink)]",
  accent: "bg-[var(--pmb-blue)] text-[var(--pmb-ink)]",
  ghost: "bg-[var(--pmb-base)] text-[var(--pmb-ink)]",
  danger: "bg-[var(--pmb-red)] text-white",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-[10px] border-4 border-[var(--pmb-ink)] px-4 py-2 text-sm font-semibold transition-transform duration-150 ease-out",
        "shadow-[6px_6px_0_var(--pmb-ink)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_var(--pmb-ink)]",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-[3px_3px_0_var(--pmb-ink)]",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});
