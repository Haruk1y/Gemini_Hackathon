"use client";

import type { ReactNode } from "react";

/* eslint-disable @next/next/no-img-element */

import { Crown } from "lucide-react";

import { useLanguage } from "@/components/providers/language-provider";
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
  myEntryFooter?: ReactNode;
}

export function Podium({ entries, myUid, myEntryFooter }: PodiumProps) {
  const { copy } = useLanguage();
  const sorted = [...entries].sort((a, b) => b.bestScore - a.bestScore);

  if (!sorted.length) {
    return null;
  }

  return (
    <div className="h-full min-h-0 w-full overflow-x-auto overflow-y-hidden px-1 pt-1 pb-4">
      <div className="flex min-w-max items-start gap-3">
        {sorted.map((entry, index) => (
          <div
            key={entry.uid}
            className={[
              "relative flex w-60 shrink-0 flex-col rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-2.5 text-center shadow-[8px_8px_0_var(--pmb-ink)]",
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
              {entry.uid === myUid ? <Badge className="bg-white">{copy.common.you}</Badge> : null}
            </p>
            <p className="font-mono text-3xl font-black">{entry.bestScore}</p>
            <div className="mt-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-2 text-left">
              <p className="text-[10px] font-black uppercase tracking-wide">{copy.common.prompt}</p>
              <p className="mt-1 h-16 overflow-y-auto font-mono text-[11px] font-semibold leading-tight">
                {entry.bestPromptPublic || copy.podium.notRecorded}
              </p>
            </div>
            {entry.uid === myUid && myEntryFooter ? <div className="mt-2">{myEntryFooter}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
