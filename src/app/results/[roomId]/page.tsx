"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo } from "react";
import { ChevronRight, Flag, LoaderCircle, LogOut } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { Podium } from "@/components/game/podium";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { placeholderImageUrl } from "@/lib/client/image";
import { useRoomPresence } from "@/lib/client/room-presence";
import {
  type AttemptData,
  type PlayerData,
  type RoomData,
  type RoundData,
  type ScoreEntry,
  useRoomSync,
} from "@/lib/client/room-sync";
import { getGameModeDefinition } from "@/lib/game/modes";

export default function ResultsPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromRound = searchParams.get("from") === "round";

  const { user } = useAuth();
  const { snapshot } = useRoomSync({ roomId, view: "results", enabled: Boolean(user) });
  const room = snapshot.room as RoomData | null;
  const round = snapshot.round as RoundData | null;
  const scores = snapshot.scores as ScoreEntry[];
  const myAttempts = snapshot.attempts as AttemptData | null;
  const me =
    user?.uid
      ? (snapshot.players.find((player) => player.uid === user.uid) as PlayerData | undefined) ?? null
      : null;
  const allowStayDuringRound = fromRound && room?.status !== "RESULTS";

  useEffect(() => {
    if (!room) return;
    if (room.status === "GENERATING_ROUND") {
      router.replace(`/transition/${roomId}`);
      return;
    }
    if (room.status === "IN_ROUND" && !allowStayDuringRound) {
      router.replace(`/round/${roomId}`);
    }
    if (room.status === "LOBBY") {
      router.replace(`/lobby/${roomId}`);
    }
  }, [allowStayDuringRound, room, roomId, router]);

  useEffect(() => {
    if (!room || !round) return;
    if (room.status !== "IN_ROUND" || !allowStayDuringRound) return;

    const trigger = async () => {
      try {
        await apiPost<{ ok: true; status: "IN_ROUND" | "RESULTS" }>(
          "/api/rounds/endIfNeeded",
          {
            roomId,
            roundId: round.roundId,
          },
        );
      } catch (error) {
        console.error("results wait endIfNeeded failed", error);
      }
    };

    void trigger();
    const intervalId = setInterval(() => {
      void trigger();
    }, 1_500);

    return () => clearInterval(intervalId);
  }, [allowStayDuringRound, room, round, roomId]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user),
  });

  const sortedScores = useMemo(
    () => [...scores].sort((a, b) => b.bestScore - a.bestScore),
    [scores],
  );
  const isResultsPhase = room?.status === "RESULTS";
  const roundIndex = room?.roundIndex ?? 0;
  const totalRounds = room?.settings?.totalRounds ?? 0;
  const currentMode = getGameModeDefinition(room?.settings?.gameMode ?? "classic");
  const isFinalRound = totalRounds > 0 && roundIndex >= totalRounds;
  const myLatestAttempt = myAttempts?.attempts?.[myAttempts.attempts.length - 1] ?? null;
  const waitingMessage = useMemo(() => {
    if (room?.status === "GENERATING_ROUND") {
      return "次ラウンド開始中です。お題画像の準備が完了すると自動でラウンド画面へ移動します。";
    }
    if (room?.status === "IN_ROUND") {
      return "集計中です。全員の採点完了後、約10秒でリザルトへ切り替わります。";
    }
    return null;
  }, [room?.status]);

  const onNext = async () => {
    if (!me?.isHost || !room) return;
    router.push(`/transition/${roomId}?start=1`);
  };

  const onLeave = () => {
    router.push(`/lobby/${roomId}`);
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">結果読み込み中...</Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex h-screen max-h-screen w-full max-w-[1500px] flex-col gap-3 overflow-hidden px-4 py-4 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4 shadow-[8px_8px_0_var(--pmb-ink)]">
        <div>
          <p className="text-sm font-black uppercase tracking-wide">Round {round.index} Result</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-4xl leading-none md:text-5xl">ランキング発表</h1>
            <Badge className="bg-white">{currentMode.label}</Badge>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isFinalRound ? (
            <Badge className="bg-[var(--pmb-red)] text-white">
              <Flag className="mr-1 h-3.5 w-3.5" /> FINAL ROUND
            </Badge>
          ) : (
            <Badge className="bg-[var(--pmb-green)]">NEXT ROUND READY</Badge>
          )}
          <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="accent"
                onClick={onNext}
                disabled={!me?.isHost || !isResultsPhase}
              >
                <ChevronRight className="mr-1 h-4 w-4" />
                {isFinalRound ? "ロビーに戻る" : "次ラウンドへ"}
              </Button>
            <Button type="button" variant="ghost" onClick={onLeave}>
              <LogOut className="mr-2 h-4 w-4" />
              ロビーに戻る
            </Button>
          </div>
          {!me?.isHost ? (
            <p className="text-xs font-semibold">次の進行はホストのみ実行できます。</p>
          ) : null}
          {room.status === "GENERATING_ROUND" ? (
            <p className="flex items-center gap-2 text-xs font-semibold">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              次ラウンド開始中...
            </p>
          ) : null}
        </div>
      </header>

      {!isResultsPhase && waitingMessage ? (
        <Card className="bg-white">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {waitingMessage}
          </p>
        </Card>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto overflow-x-visible pr-3 pb-3">
        <div className="space-y-4">
          <Card className="overflow-hidden bg-white p-4">
            <h2 className="text-2xl font-black md:text-3xl">ランキング発表</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-[340px_1fr] lg:items-stretch">
              <div className="lg:flex lg:h-full lg:flex-col">
                <p className="h-6 text-sm font-bold">お題画像</p>
                <div className="mt-2 h-[260px] w-full sm:h-[300px]">
                  <img
                    src={round.targetImageUrl || placeholderImageUrl(round.gmTitle || `round-${round.index}`)}
                    alt="target"
                    className="h-full w-full rounded-lg border-4 border-[var(--pmb-ink)] bg-white object-contain p-1"
                  />
                </div>
                {round.reveal?.gmPromptPublic ? (
                  <div className="mt-3 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                    <p className="text-xs font-bold">正解プロンプト</p>
                    <p className="mt-1 font-mono text-xs font-semibold">
                      {round.reveal.gmPromptPublic}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="lg:flex lg:h-full lg:flex-col lg:border-l-4 lg:border-[var(--pmb-ink)] lg:pl-4">
                <p className="h-6 text-sm font-bold">生成画像</p>
                <div className="mt-2 flex-1">
                  <Podium entries={sortedScores} myUid={user?.uid} />
                </div>
              </div>
            </div>
          </Card>

          {isResultsPhase ? (
            <Card className="bg-white p-4">
              <h2 className="text-lg">あなたの採点根拠</h2>
              {myLatestAttempt ? (
                <div className="mt-2 text-sm font-semibold">
                  {myLatestAttempt.matchedElements?.length ? (
                    <p className="text-[var(--pmb-green)]">一致: {myLatestAttempt.matchedElements.join(" / ")}</p>
                  ) : null}
                  {myLatestAttempt.missingElements?.length ? (
                    <p className="mt-1 text-[var(--pmb-red)]">
                      不足: {myLatestAttempt.missingElements.join(" / ")}
                    </p>
                  ) : (
                    <p className="mt-1">不足: なし</p>
                  )}
                  {myLatestAttempt.judgeNote ? (
                    <p className="mt-1">{myLatestAttempt.judgeNote}</p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm font-semibold">
                  このラウンドの採点根拠はまだありません。
                </p>
              )}
            </Card>
          ) : null}
        </div>
      </section>
    </main>
  );
}
