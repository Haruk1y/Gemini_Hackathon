import { Crown } from "lucide-react";

interface Entry {
  uid: string;
  displayName: string;
  bestScore: number;
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
          className="rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4 text-center shadow-[8px_8px_0_var(--pmb-ink)]"
        >
          <p className="text-xs font-bold uppercase">#{index + 1}</p>
          <p className="mt-1 text-lg font-extrabold">{entry.displayName}</p>
          <p className="font-mono text-2xl font-black">{entry.bestScore}</p>
          {index === 0 && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full border-2 border-[var(--pmb-ink)] bg-white px-2 py-0.5 text-xs font-bold">
              <Crown className="h-3 w-3" /> Winner
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
