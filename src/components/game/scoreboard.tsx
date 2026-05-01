"use client";

import { Trophy } from "lucide-react";

import { useLanguage } from "@/components/providers/language-provider";
import { Card } from "@/components/ui/card";

interface ScoreEntry {
  uid: string;
  displayName: string;
  bestScore: number;
  totalScore?: number;
}

interface ScoreboardProps {
  entries: ScoreEntry[];
  myUid?: string;
  showTotals?: boolean;
}

export function Scoreboard({ entries, myUid, showTotals = false }: ScoreboardProps) {
  const { copy } = useLanguage();
  const sorted = [...entries].sort((a, b) => b.bestScore - a.bestScore);

  return (
    <Card className="space-y-2 bg-white/80">
      <h3 className="flex items-center gap-2 text-lg font-bold">
        <Trophy className="h-5 w-5" /> {copy.scoreboard.title}
      </h3>
      <div className="space-y-2">
        {sorted.map((entry, index) => (
          <div
            key={entry.uid}
            className={[
              "flex items-center justify-between rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2",
              entry.uid === myUid ? "bg-[var(--pmb-yellow)]" : "",
            ].join(" ")}
          >
            <p className="truncate text-sm font-semibold">
              {index + 1}. {entry.displayName}
            </p>
            <div className="text-right">
              <p className="font-mono text-lg font-bold">
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
        ))}
      </div>
    </Card>
  );
}
