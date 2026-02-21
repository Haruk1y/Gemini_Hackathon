"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ResultShareCardProps {
  roomId: string;
  winnerName: string;
  winnerScore: number;
}

export function ResultShareCard({
  roomId,
  winnerName,
  winnerScore,
}: ResultShareCardProps) {
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const onExport = async () => {
    if (!cardRef.current || busy) return;

    setBusy(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `prompt-mirror-${roomId}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card
        ref={cardRef}
        className="rounded-2xl bg-[linear-gradient(135deg,var(--pmb-yellow),var(--pmb-blue))] p-6"
      >
        <p className="text-xs font-bold">Prompt Mirror Battle</p>
        <h3 className="mt-2 text-2xl font-black">WINNER: {winnerName}</h3>
        <p className="font-mono text-3xl font-black">{winnerScore} pts</p>
        <p className="mt-4 text-sm font-semibold">Room: {roomId}</p>
      </Card>
      <Button type="button" onClick={onExport} variant="accent" disabled={busy}>
        {busy ? "書き出し中..." : "共有カードを書き出し"}
      </Button>
    </div>
  );
}
