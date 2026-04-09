"use client";

import { useLanguage } from "@/components/providers/language-provider";
import { cn } from "@/lib/utils/cn";

const OPTIONS = [
  { value: "ja", label: "JP" },
  { value: "en", label: "EN" },
] as const;

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, copy } = useLanguage();

  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[4px_4px_0_var(--pmb-ink)]",
        className,
      )}
      role="group"
      aria-label={copy.languageToggle.ariaLabel}
    >
      {OPTIONS.map((option) => {
        const active = option.value === language;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLanguage(option.value)}
            aria-pressed={active}
            className={cn(
              "flex h-11 min-w-[60px] items-center justify-center px-3 text-xs font-black tracking-[0.08em] transition-colors duration-150",
              "border-r-4 border-[var(--pmb-ink)] last:border-r-0",
              active
                ? "bg-[var(--pmb-blue)] text-[var(--pmb-ink)]"
                : "bg-white text-[var(--pmb-ink)] hover:bg-[var(--pmb-base)]",
            )}
          >
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
