"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flag, LoaderCircle, LogOut, X } from "lucide-react";
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
  const voteProgress = snapshot.voteProgress;
  const finalSimilarityScore = snapshot.finalSimilarityScore ?? null;
  const turnTimeline = snapshot.turnTimeline;
  const revealLocked = Boolean(snapshot.revealLocked);
  const myRole = snapshot.myRole;
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
  const isImpostorMode =
    room?.settings?.gameMode === "impostor" && round?.modeState?.kind === "impostor";
  const isFinalRound = totalRounds > 0 && roundIndex >= totalRounds;
  const myLatestAttempt = myAttempts?.attempts?.[myAttempts.attempts.length - 1] ?? null;
  const [showJudgeReason, setShowJudgeReason] = useState(false);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const waitingMessage = useMemo(() => {
    if (room?.status === "GENERATING_ROUND") {
      return "次ラウンド開始中です。お題画像の準備が完了すると自動でラウンド画面へ移動します。";
    }
    if (room?.status === "IN_ROUND") {
      return "集計中です。全員の採点完了後、約10秒でリザルトへ切り替わります。";
    }
    return null;
  }, [room?.status]);
  const orderedTurnTimeline = useMemo(() => {
    const turnOrder = round?.modeState?.turnOrder;
    if (!turnOrder?.length) {
      return turnTimeline;
    }

    const timelineByUid = new Map(turnTimeline.map((entry) => [entry.uid, entry] as const));
    const orderedEntries = turnOrder.flatMap((uid) => {
      const entry = timelineByUid.get(uid);
      return entry ? [entry] : [];
    });
    const orderedUidSet = new Set(turnOrder);
    const extraEntries = turnTimeline.filter((entry) => !orderedUidSet.has(entry.uid));

    return [...orderedEntries, ...extraEntries];
  }, [round?.modeState?.turnOrder, turnTimeline]);

  const onNext = async () => {
    if (!me?.isHost || !room) return;
    router.push(`/transition/${roomId}?start=1`);
  };

  const onLeave = () => {
    const leave = async () => {
      if (isImpostorMode) {
        if (!me?.isHost || !isResultsPhase) return;

        setLobbyBusy(true);
        try {
          await apiPost("/api/rooms/back-to-lobby", { roomId });
          router.replace(`/lobby/${roomId}`);
        } catch (error) {
          console.error("impostor return to lobby failed", error);
        } finally {
          setLobbyBusy(false);
        }
        return;
      }

      if (isFinalRound && me?.isHost && isResultsPhase) {
        setLobbyBusy(true);
        try {
          await apiPost("/api/rounds/next", { roomId });
        } catch (error) {
          console.error("final return to lobby failed", error);
        } finally {
          setLobbyBusy(false);
        }
      }

      router.push(`/lobby/${roomId}`);
    };

    void leave();
  };

  const onVote = async (targetUid: string) => {
    if (!room || !round || !me || voteBusy || !revealLocked) return;

    setVoteBusy(true);
    setVoteError(null);
    try {
      await apiPost("/api/rounds/vote", {
        roomId,
        roundId: round.roundId,
        targetUid,
      });
    } catch (error) {
      console.error("vote failed", error);
      setVoteError("投票に失敗しました。");
    } finally {
      setVoteBusy(false);
    }
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">結果読み込み中...</Card>
      </main>
    );
  }

  if (isImpostorMode) {
    const accusedUid = round.modeState?.voteTarget ?? null;
    const impostorUid = orderedTurnTimeline.find((entry) => entry.role === "impostor")?.uid ?? null;
    const crewWin =
      !revealLocked &&
      finalSimilarityScore !== null &&
      (finalSimilarityScore >= 70 || (accusedUid !== null && accusedUid === impostorUid));
    const canReturnToLobby = Boolean(me?.isHost) && isResultsPhase;
    const myVoteTargetUid = voteProgress?.meTargetUid ?? null;

    return (
      <main className="page-enter mx-auto flex min-h-[100dvh] w-full max-w-[1500px] flex-col gap-3 overflow-x-hidden px-4 py-4 md:px-6 lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-3 shadow-[8px_8px_0_var(--pmb-ink)] md:p-4">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-wide">Round {round.index} Result</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-4xl leading-none md:text-5xl">Art Impostor</h1>
              <Badge className={revealLocked ? "bg-white" : "bg-[var(--pmb-green)]"}>
                {revealLocked ? "VOTING" : "REVEAL"}
              </Badge>
              <Badge className={myRole === "impostor" ? "bg-[var(--pmb-red)] text-white" : "bg-white"}>
                {myRole === "impostor" ? "YOU: IMPOSTOR" : "YOU: AGENT"}
              </Badge>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 md:items-end">
            {isFinalRound ? (
              <Badge className="bg-[var(--pmb-red)] text-white">
                <Flag className="mr-1 h-3.5 w-3.5" /> FINAL ROUND
              </Badge>
            ) : (
              <Badge className="bg-[var(--pmb-green)]">NEXT ROUND READY</Badge>
            )}
            <div className="flex w-full flex-wrap gap-2 md:justify-end">
              {!isFinalRound ? (
                <Button
                  type="button"
                  variant="accent"
                  onClick={onNext}
                  disabled={!me?.isHost || !isResultsPhase || revealLocked}
                >
                  <ChevronRight className="mr-1 h-4 w-4" />
                  次ラウンドへ
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                onClick={onLeave}
                disabled={lobbyBusy || !canReturnToLobby}
              >
                {lobbyBusy ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                ロビーに戻る
              </Button>
            </div>
            {lobbyBusy ? (
              <p className="text-xs font-semibold">ロビーへ戻しています。全員の画面が同じ部屋ロビーへ切り替わります。</p>
            ) : !me?.isHost ? (
              <p className="text-xs font-semibold">ホストがロビーへ戻すのを待っています。</p>
            ) : canReturnToLobby ? (
              <p className="text-xs font-semibold">ロビーへ戻ると、この部屋の全員が同じロビー画面へ戻ります。</p>
            ) : null}
          </div>
        </header>

        {!isResultsPhase && waitingMessage ? (
          <Card className="bg-white p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {waitingMessage}
            </p>
          </Card>
        ) : null}

        <section className="min-h-0 flex-1 overflow-hidden">
          <Card className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-3 md:p-4">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-black md:text-lg">
                    Imposterだと思うプレイヤーに投票しよう！
                  </p>
                  <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                    {orderedTurnTimeline.length} STEPS
                  </Badge>
                </div>
              </div>

              <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2 lg:w-auto">
                <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em]">
                    Final Similarity
                  </p>
                  <p className="mt-1 font-mono text-xl font-black md:text-2xl">
                    {finalSimilarityScore ?? "--"} / 100
                  </p>
                </div>
                <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em]">
                    Vote Progress
                  </p>
                  <p className="mt-1 font-mono text-xl font-black md:text-2xl">
                    {voteProgress?.submitted ?? 0} / {voteProgress?.total ?? 0}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold">
                    {myVoteTargetUid ? "あなたの投票は送信済みです。" : "まだ投票していません。"}
                  </p>
                </div>
              </div>
            </div>

            {voteError ? (
              <p className="mt-3 text-sm font-semibold text-[var(--pmb-red)]">{voteError}</p>
            ) : null}

            {!revealLocked ? (
              <div className="mt-3 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.16em]">Outcome</p>
                <p className="mt-1 text-2xl font-black">{crewWin ? "Crew Win" : "Impostor Win"}</p>
                <p className="mt-1 text-sm font-semibold">
                  最終類似度は {finalSimilarityScore ?? "--"} / 100。
                  {accusedUid === null
                    ? " 投票は同票で決着なし。"
                    : accusedUid === impostorUid
                      ? " 投票で impostor を的中。"
                      : " 投票は外れ。"}
                </p>
              </div>
            ) : null}

            <div className="mt-3 min-h-0 flex-1 overflow-hidden">
              <div className="grid h-full auto-rows-[minmax(0,1fr)] gap-3 overflow-y-auto pr-1 md:grid-cols-2 lg:grid-cols-3">
                {orderedTurnTimeline.map((entry, index) => {
                  const votedPlayer = !revealLocked
                    ? snapshot.players.find((player) => player.uid === entry.votedForUid)
                    : null;
                  const isSelfCard = entry.uid === user?.uid;
                  const isSelectedVote = myVoteTargetUid === entry.uid;

                  return (
                    <div
                      key={`${entry.uid}-${index}`}
                      className="flex h-full min-h-0 flex-col rounded-lg border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3"
                    >
                      <div className="h-32 overflow-hidden rounded border-2 border-[var(--pmb-ink)] bg-white sm:h-36 xl:h-40">
                        <img
                          src={entry.imageUrl || placeholderImageUrl(entry.displayName)}
                          alt={entry.displayName}
                          className="h-full w-full object-contain p-1"
                        />
                      </div>

                      <div className="mt-3 flex min-h-0 flex-1 flex-col">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate font-black">
                            {index + 1}. {entry.displayName}
                          </p>
                          {entry.kind === "cpu" ? <Badge className="bg-white">CPU</Badge> : null}
                          {entry.uid === user?.uid ? <Badge className="bg-white">YOU</Badge> : null}
                          {!revealLocked && entry.role ? (
                            <Badge
                              className={
                                entry.role === "impostor"
                                  ? "bg-[var(--pmb-red)] text-white"
                                  : "bg-[var(--pmb-green)] text-white"
                              }
                            >
                              {entry.role}
                            </Badge>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-lg font-black">{entry.similarityScore} pts</p>
                          {entry.timedOut ? (
                            <Badge className="bg-white px-2 py-0 text-[10px]">TIMEOUT</Badge>
                          ) : null}
                        </div>

                        {revealLocked ? (
                          <div className="mt-auto pt-3">
                            <Button
                              type="button"
                              variant={isSelectedVote ? "accent" : "ghost"}
                              disabled={voteBusy || isSelfCard}
                              onClick={() => void onVote(entry.uid)}
                              className="w-full"
                            >
                              {isSelfCard
                                ? "自分には投票できません"
                                : isSelectedVote
                                  ? "このプレイヤーに投票中"
                                  : "このプレイヤーに投票"}
                            </Button>
                          </div>
                        ) : (
                          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-xs font-semibold">
                            {entry.prompt ? (
                              <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-2">
                                <p className="text-[10px] font-black uppercase tracking-wide">
                                  Prompt
                                </p>
                                <p className="mt-1 break-words leading-relaxed">{entry.prompt}</p>
                              </div>
                            ) : null}

                            <div className="mt-2 break-words">
                              <p>一致: {(entry.matchedElements ?? []).join(" / ") || "なし"}</p>
                              <p className="mt-1">
                                不足: {(entry.missingElements ?? []).join(" / ") || "なし"}
                              </p>
                              {entry.judgeNote ? <p className="mt-1">{entry.judgeNote}</p> : null}
                              <p className="mt-1">
                                投票先:{" "}
                                {votedPlayer?.displayName ??
                                  (entry.votedForUid ? entry.votedForUid : "未公開")}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="page-enter mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-[1500px] flex-col gap-2 overflow-hidden px-4 py-4 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-3 shadow-[8px_8px_0_var(--pmb-ink)] md:p-4">
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
            {!isFinalRound ? (
              <Button
                type="button"
                variant="accent"
                onClick={onNext}
                disabled={!me?.isHost || !isResultsPhase}
              >
                <ChevronRight className="mr-1 h-4 w-4" />
                次ラウンドへ
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onLeave} disabled={lobbyBusy}>
              {lobbyBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              ロビーに戻る
            </Button>
          </div>
          {!me?.isHost && !isFinalRound ? (
            <p className="text-xs font-semibold">次の進行はホストのみ実行できます。</p>
          ) : null}
          {room.status === "GENERATING_ROUND" && !isFinalRound ? (
            <p className="flex items-center gap-2 text-xs font-semibold">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              次ラウンド開始中...
            </p>
          ) : null}
        </div>
      </header>

      {!isResultsPhase && waitingMessage ? (
        <Card className="bg-white p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {waitingMessage}
          </p>
        </Card>
      ) : null}

      <section className="min-h-0 flex-1 overflow-hidden">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-3 md:p-4">
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-stretch">
            <div className="min-h-0 lg:flex lg:h-full lg:flex-col">
              <p className="h-7 text-base font-black md:text-lg">お題画像</p>
              <div className="mt-2 h-[220px] w-full shrink-0 sm:h-[260px] lg:h-[240px] xl:h-[280px]">
                <img
                  src={round.targetImageUrl || placeholderImageUrl(round.gmTitle || `round-${round.index}`)}
                  alt="target"
                  className="h-full w-full rounded-lg border-4 border-[var(--pmb-ink)] bg-white object-contain p-1"
                />
              </div>
              {round.reveal?.gmPromptPublic ? (
                <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                  <p className="shrink-0 text-xs font-bold">正解プロンプト</p>
                  <div className="mt-1 h-full max-h-[min(28vh,220px)] overflow-y-auto pr-1">
                    <p className="font-mono text-xs font-semibold break-words">
                      {round.reveal.gmPromptPublic}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 overflow-hidden lg:flex lg:h-full lg:flex-col lg:border-l-4 lg:border-[var(--pmb-ink)] lg:pl-4">
              <p className="h-7 text-base font-black md:text-lg">生成画像</p>
              <div className="mt-2 min-h-0 flex-1 overflow-hidden pb-2">
                <Podium
                  entries={sortedScores}
                  myUid={user?.uid}
                  myEntryFooter={
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowJudgeReason(true)}
                      disabled={!myLatestAttempt}
                      className="w-full bg-white"
                    >
                      採点根拠を見る
                    </Button>
                  }
                />
              </div>
            </div>
          </div>
        </Card>
      </section>
    </main>

      {showJudgeReason ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={() => setShowJudgeReason(false)}
        >
          <Card
            className="w-full max-w-xl bg-white p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em]">Judge Note</p>
                <h2 className="mt-1 text-2xl md:text-3xl">あなたの採点根拠</h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowJudgeReason(false)}
                className="h-11 w-11 p-0"
                aria-label="採点根拠を閉じる"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-4 max-h-[min(60vh,420px)] overflow-y-auto rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-4 text-sm font-semibold">
              {myLatestAttempt ? (
                <>
                  {myLatestAttempt.matchedElements?.length ? (
                    <p className="text-[var(--pmb-green)]">
                      一致: {myLatestAttempt.matchedElements.join(" / ")}
                    </p>
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
                </>
              ) : (
                <p>このラウンドの採点根拠はまだありません。</p>
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
