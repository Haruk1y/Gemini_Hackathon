"use client";
/* eslint-disable @next/next/no-img-element */

import { Trophy } from "lucide-react";

import { useLanguage } from "@/components/providers/language-provider";
import { Card } from "@/components/ui/card";
import { placeholderImageUrl } from "@/lib/client/image";
import { cn } from "@/lib/utils/cn";

interface ScoreEntry {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl?: string;
  totalScore?: number;
}

interface ScoreboardProps {
  entries: ScoreEntry[];
  className?: string;
  myUid?: string;
  showImages?: boolean;
  showTotals?: boolean;
}

export function Scoreboard({
  entries,
  className,
  myUid,
  showImages = false,
  showTotals = false,
}: ScoreboardProps) {
  const { copy } = useLanguage();
  const sorted = [...entries].sort((a, b) => b.bestScore - a.bestScore);

  return (
    <Card className={cn("flex min-h-0 flex-col bg-white/80", className)}>
      <h3
        className={cn(
          "mb-2 flex shrink-0 items-center gap-2 font-bold",
          showImages ? "mb-4 text-3xl font-black" : "text-lg",
        )}
      >
        <Trophy className={cn(showImages ? "h-8 w-8" : "h-5 w-5")} />{" "}
        {copy.scoreboard.title}
      </h3>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto pr-1",
          showImages ? "space-y-4" : "space-y-3",
        )}
      >
        {sorted.map((entry, index) => (
          <div
            key={entry.uid}
            className={cn(
              "rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2",
              showImages
                ? "grid min-h-28 grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2"
                : "flex items-center justify-between",
              entry.uid === myUid ? "bg-[var(--pmb-yellow)]" : "",
            )}
          >
            <div className="flex min-w-0 flex-col justify-between gap-2">
              <p
                className={cn(
                  "truncate font-semibold",
                  showImages ? "text-xl leading-tight font-black" : "text-sm",
                )}
              >
                {index + 1}. {entry.displayName}
              </p>
              <div className={showImages ? "text-left" : "text-right"}>
                <p
                  className={cn(
                    "font-mono font-bold",
                    showImages ? "text-4xl leading-none font-black" : "text-lg",
                  )}
                >
                  <span className="mr-1 text-[10px] tracking-[0.16em] uppercase">
                    {showTotals ? copy.common.round : ""}
                  </span>
                  {entry.bestScore}
                </p>
                {showTotals ? (
                  <p className="font-mono text-[11px] font-black tracking-[0.08em] uppercase">
                    {copy.common.total}: {entry.totalScore ?? entry.bestScore}
                  </p>
                ) : null}
              </div>
            </div>
            {showImages ? (
              <div className="aspect-square h-24 self-center justify-self-end rounded-md border-2 border-[var(--pmb-ink)] bg-white">
                <img
                  src={
                    entry.bestImageUrl || placeholderImageUrl(entry.displayName)
                  }
                  alt={`${entry.displayName} best`}
                  className="h-full w-full object-contain p-1"
                  onError={(event) => {
                    if (
                      event.currentTarget.dataset.fallbackApplied === "true"
                    ) {
                      return;
                    }

                    event.currentTarget.dataset.fallbackApplied = "true";
                    event.currentTarget.src = placeholderImageUrl(
                      entry.displayName,
                    );
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
