"use client";

import { Trophy } from "lucide-react";

import { useLanguage } from "@/components/providers/language-provider";
import { Card } from "@/components/ui/card";

interface ScoreEntry {
  uid: string;
  displayName: string;
  bestScore: number;
}

interface ScoreboardProps {
  entries: ScoreEntry[];
  myUid?: string;
}

export function Scoreboard({ entries, myUid }: ScoreboardProps) {
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
            <p className="font-mono text-lg font-bold">{entry.bestScore}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
