import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-[10px] border-4 border-[var(--pmb-ink)] bg-white px-3 py-2 text-sm text-[var(--pmb-ink)]",
          "placeholder:text-[color:color-mix(in_srgb,var(--pmb-ink)_55%,white)] focus:outline-none focus:ring-4 focus:ring-[var(--pmb-blue)]/30",
          className,
        )}
        {...props}
      />
    );
  },
);
