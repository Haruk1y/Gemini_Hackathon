/* eslint-disable @next/next/no-img-element */

import { placeholderImageUrl } from "@/lib/client/image";

interface Entry {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl?: string;
}

interface PodiumProps {
  entries: Entry[];
}

export function Podium({ entries }: PodiumProps) {
  const sorted = [...entries].sort((a, b) => b.bestScore - a.bestScore).slice(0, 3);

  if (!sorted.length) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {sorted.map((entry, index) => (
        <div
          key={entry.uid}
          className="rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-3 text-center shadow-[8px_8px_0_var(--pmb-ink)]"
        >
          <img
            src={entry.bestImageUrl || placeholderImageUrl(entry.displayName)}
            alt={`${entry.displayName} best`}
            className="mb-2 aspect-square w-full rounded-lg border-2 border-[var(--pmb-ink)] bg-white object-cover"
          />
          <p className="text-xs font-bold uppercase">#{index + 1}</p>
          <p className="mt-1 text-lg font-extrabold">{entry.displayName}</p>
          <p className="font-mono text-2xl font-black">{entry.bestScore}</p>
        </div>
      ))}
    </div>
  );
}
