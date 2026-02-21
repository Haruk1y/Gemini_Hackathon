import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[140px] w-full resize-y rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white px-3 py-2 text-sm text-[var(--pmb-ink)]",
        "placeholder:text-[color:color-mix(in_srgb,var(--pmb-ink)_55%,white)] focus:outline-none focus:ring-4 focus:ring-[var(--pmb-blue)]/30",
        className,
      )}
      {...props}
    />
  );
});
