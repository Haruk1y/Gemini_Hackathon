import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-4 shadow-[8px_8px_0_var(--pmb-ink)]",
          className,
        )}
        {...props}
      />
    );
  },
);
