/* eslint-disable @next/next/no-img-element */

import { Crown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { placeholderImageUrl } from "@/lib/client/image";

interface Entry {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl?: string;
  bestPromptPublic?: string;
}

interface PodiumProps {
  entries: Entry[];
  myUid?: string;
}

export function Podium({ entries, myUid }: PodiumProps) {
  const sorted = [...entries].sort((a, b) => b.bestScore - a.bestScore);

  if (!sorted.length) {
    return null;
  }

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex min-w-max gap-3">
        {sorted.map((entry, index) => (
          <div
            key={entry.uid}
            className={[
              "relative w-64 shrink-0 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-3 text-center shadow-[8px_8px_0_var(--pmb-ink)]",
              entry.uid === myUid ? "bg-[var(--pmb-blue)]" : "",
            ].join(" ")}
          >
            {index === 0 ? (
              <div className="absolute right-2 top-2 rounded-full border-2 border-[var(--pmb-ink)] bg-white p-1">
                <Crown className="h-4 w-4" />
              </div>
            ) : null}
            <img
              src={entry.bestImageUrl || placeholderImageUrl(entry.displayName)}
              alt={`${entry.displayName} best`}
              className="mb-2 aspect-square w-full rounded-lg border-2 border-[var(--pmb-ink)] bg-white object-contain p-1"
            />
            <p className="text-2xl font-black">#{index + 1}</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-xl font-extrabold">
              {entry.displayName}
              {entry.uid === myUid ? <Badge className="bg-white">YOU</Badge> : null}
            </p>
            <p className="font-mono text-3xl font-black">{entry.bestScore}</p>
            <div className="mt-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-2 text-left">
              <p className="text-[10px] font-black uppercase tracking-wide">Prompt</p>
              <p className="mt-1 max-h-16 overflow-y-auto font-mono text-[11px] font-semibold leading-tight">
                {entry.bestPromptPublic || "未記録"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
