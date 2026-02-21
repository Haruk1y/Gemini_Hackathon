import { type HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2.5 py-0.5 text-xs font-semibold text-[var(--pmb-ink)]",
        className,
      )}
      {...props}
    />
  );
}
