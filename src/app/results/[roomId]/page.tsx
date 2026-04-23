"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flag, LoaderCircle, LogOut, X } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { Podium } from "@/components/game/podium";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { placeholderImageUrl } from "@/lib/client/image";
import { buildCurrentAppPath } from "@/lib/client/paths";
import { useRoomPresence } from "@/lib/client/room-presence";
import {
  resolveUiErrorMessage,
  toUiError,
  type UiError,
} from "@/lib/i18n/errors";
import {
  type AttemptData,
  type PlayerData,
  type RoomData,
  type RoomSyncSnapshot,
  type RoundData,
  type ScoreEntry,
  useRoomSync,
} from "@/lib/client/room-sync";
import { getGameModeDefinition } from "@/lib/game/modes";
import { cn } from "@/lib/utils/cn";

function resolveAspectRatioClass(aspectRatio?: "1:1" | "16:9" | "9:16") {
  if (aspectRatio === "16:9") return "aspect-video";
  if (aspectRatio === "9:16") return "aspect-[9/16]";
  return "aspect-square";
}

export default function ResultsPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromRound = searchParams.get("from") === "round";

  const { language, copy } = useLanguage();
  const { user } = useAuth();
  const { snapshot } = useRoomSync({
    roomId,
    view: "results",
    enabled: Boolean(user),
  });
  const [frozenResultsSnapshot, setFrozenResultsSnapshot] =
    useState<RoomSyncSnapshot | null>(null);
  const liveRoom = snapshot.room as RoomData | null;
  const liveRound = snapshot.round as RoundData | null;
  const liveRoomStatus = liveRoom?.status ?? null;

  useEffect(() => {
    if (liveRoomStatus === "RESULTS" && liveRound) {
      setFrozenResultsSnapshot(snapshot);
    }
  }, [liveRoom, liveRoomStatus, liveRound, snapshot]);

  const activeSnapshot =
    liveRoomStatus === "LOBBY" && frozenResultsSnapshot
      ? frozenResultsSnapshot
      : snapshot;
  const room = activeSnapshot.room as RoomData | null;
  const round = activeSnapshot.round as RoundData | null;
  const scores = activeSnapshot.scores as ScoreEntry[];
  const myAttempts = activeSnapshot.attempts as AttemptData | null;
  const changeResults = activeSnapshot.changeResults ?? [];
  const voteProgress = activeSnapshot.voteProgress;
  const finalSimilarityScore = activeSnapshot.finalSimilarityScore ?? null;
  const turnTimeline = activeSnapshot.turnTimeline;
  const revealLocked = Boolean(activeSnapshot.revealLocked);
  const myRole = activeSnapshot.myRole;
  const me = user?.uid
    ? ((activeSnapshot.players.find((player) => player.uid === user.uid) as
        | PlayerData
        | undefined) ?? null)
    : null;
  const allowStayDuringRound = fromRound && room?.status !== "RESULTS";

  useEffect(() => {
    if (!liveRoom) return;
    if (liveRoom.status === "GENERATING_ROUND") {
      router.replace(buildCurrentAppPath(`/transition/${roomId}`));
      return;
    }
    if (liveRoom.status === "IN_ROUND" && !allowStayDuringRound) {
      router.replace(buildCurrentAppPath(`/round/${roomId}`));
    }
    if (liveRoom.status === "LOBBY" && !frozenResultsSnapshot) {
      router.replace(buildCurrentAppPath(`/lobby/${roomId}`));
    }
  }, [allowStayDuringRound, frozenResultsSnapshot, liveRoom, roomId, router]);

  useEffect(() => {
    if (!liveRoom || !liveRound) return;
    if (liveRoom.status !== "IN_ROUND" || !allowStayDuringRound) return;

    const trigger = async () => {
      try {
        await apiPost<{ ok: true; status: "IN_ROUND" | "RESULTS" }>(
          "/api/rounds/endIfNeeded",
          {
            roomId,
            roundId: liveRound.roundId,
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
  }, [allowStayDuringRound, liveRoom, liveRound, roomId]);

  useRoomPresence({
    roomId,
    enabled: Boolean(liveRoom && user),
  });

  const sortedScores = useMemo(
    () => [...scores].sort((a, b) => b.bestScore - a.bestScore),
    [scores],
  );
  const isResultsPhase = room?.status === "RESULTS";
  const roundIndex = room?.roundIndex ?? 0;
  const totalRounds = room?.settings?.totalRounds ?? 0;
  const currentMode = getGameModeDefinition(
    room?.settings?.gameMode ?? "classic",
    language,
  );
  const isImpostorMode =
    room?.settings?.gameMode === "impostor" &&
    round?.modeState?.kind === "impostor";
  const isChangeMode =
    room?.settings?.gameMode === "change" &&
    round?.modeState?.kind === "change";
  const isFinalRound = totalRounds > 0 && roundIndex >= totalRounds;
  const canEnterLobby = liveRoomStatus === "LOBBY";
  const canHostReturnRoomToLobby =
    Boolean(me?.isHost) &&
    liveRoomStatus === "RESULTS" &&
    (isImpostorMode || isFinalRound);
  const myLatestAttempt =
    myAttempts?.attempts?.[myAttempts.attempts.length - 1] ?? null;
  const [showJudgeReason, setShowJudgeReason] = useState(false);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<UiError | null>(null);
  const waitingMessage = useMemo(() => {
    if (room?.status === "GENERATING_ROUND") {
      return copy.results.waitingGenerating;
    }
    if (room?.status === "IN_ROUND") {
      return copy.results.waitingScoring;
    }
    return null;
  }, [
    copy.results.waitingGenerating,
    copy.results.waitingScoring,
    room?.status,
  ]);
  const orderedTurnTimeline = useMemo(() => {
    const turnOrder = round?.modeState?.turnOrder;
    if (!turnOrder?.length) {
      return turnTimeline;
    }

    const timelineByUid = new Map(
      turnTimeline.map((entry) => [entry.uid, entry] as const),
    );
    const orderedEntries = turnOrder.flatMap((uid) => {
      const entry = timelineByUid.get(uid);
      return entry ? [entry] : [];
    });
    const orderedUidSet = new Set(turnOrder);
    const extraEntries = turnTimeline.filter(
      (entry) => !orderedUidSet.has(entry.uid),
    );

    return [...orderedEntries, ...extraEntries];
  }, [round?.modeState?.turnOrder, turnTimeline]);
  const sortedChangeResults = useMemo(
    () =>
      [...changeResults].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
        const aCreated =
          typeof a.createdAt === "string"
            ? new Date(a.createdAt).getTime()
            : Number.MAX_SAFE_INTEGER;
        const bCreated =
          typeof b.createdAt === "string"
            ? new Date(b.createdAt).getTime()
            : Number.MAX_SAFE_INTEGER;
        return aCreated - bCreated;
      }),
    [changeResults],
  );

  const lobbyHintMessage = (() => {
    if (lobbyBusy) {
      return copy.results.returningToLobby;
    }

    if (canEnterLobby) {
      return copy.results.returnToLobbyHint;
    }

    if (isImpostorMode || isFinalRound) {
      return me?.isHost
        ? copy.results.returnToLobbyHint
        : copy.results.waitingHostReturn;
    }

    return null;
  })();

  const onNext = async () => {
    if (!me?.isHost || !room) return;
    router.push(buildCurrentAppPath(`/transition/${roomId}?start=1`));
  };

  const onLeave = () => {
    const leave = async () => {
      if (canEnterLobby) {
        router.push(buildCurrentAppPath(`/lobby/${roomId}`));
        return;
      }

      if (isImpostorMode) {
        if (!me?.isHost || !isResultsPhase) return;

        setLobbyBusy(true);
        try {
          await apiPost("/api/rooms/back-to-lobby", { roomId });
          router.replace(buildCurrentAppPath(`/lobby/${roomId}`));
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

      router.push(buildCurrentAppPath(`/lobby/${roomId}`));
    };

    void leave();
  };

  const onVote = async (targetUid: string) => {
    if (!liveRoom || !liveRound || !room || !round || !me || voteBusy || !revealLocked) return;
    if (liveRoom.status !== "RESULTS") return;

    setVoteBusy(true);
    setVoteError(null);
    try {
      await apiPost("/api/rounds/vote", {
        roomId,
        roundId: liveRound.roundId,
        targetUid,
      });
    } catch (error) {
      console.error("vote failed", error);
      setVoteError(toUiError(error, "voteFailed"));
    } finally {
      setVoteBusy(false);
    }
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">{copy.results.loading}</Card>
      </main>
    );
  }

  if (isChangeMode) {
    const canReturnToLobby = canEnterLobby || canHostReturnRoomToLobby;
    const answerBox = round.reveal?.answerBox;
    const changedImageUrl = round.modeState?.changedImageUrl || round.targetImageUrl;
    const aspectClass = resolveAspectRatioClass(room.settings?.aspectRatio);

    return (
      <main className="page-enter mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-[1500px] flex-col gap-2 overflow-hidden px-4 py-4 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-3 shadow-[8px_8px_0_var(--pmb-ink)] md:p-4">
          <div>
            <p className="text-sm font-black tracking-wide uppercase">
              {copy.common.roundResult(round.index)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-4xl leading-none md:text-5xl">
                {copy.results.clickResults}
              </h1>
              <Badge className="bg-white">{currentMode.label}</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isFinalRound ? (
              <Badge className="bg-[var(--pmb-red)] text-white">
                <Flag className="mr-1 h-3.5 w-3.5" /> {copy.common.finalRound}
              </Badge>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {!isFinalRound ? (
                <Button
                  type="button"
                  variant="accent"
                  onClick={onNext}
                  disabled={!me?.isHost || !isResultsPhase}
                >
                  <ChevronRight className="mr-1 h-4 w-4" />
                  {copy.results.nextRound}
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
                {copy.results.backToLobby}
              </Button>
            </div>
            {lobbyHintMessage ? (
              <p className="text-xs font-semibold">{lobbyHintMessage}</p>
            ) : null}
            {!me?.isHost && !isFinalRound ? (
              <p className="text-xs font-semibold">
                {copy.results.hostOnlyNextStep}
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
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="min-h-0 overflow-y-auto pr-1">
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      {
                        label: copy.results.beforeImage,
                        imageUrl: round.targetImageUrl,
                      },
                      {
                        label: copy.results.afterImage,
                        imageUrl: changedImageUrl,
                      },
                    ].map((entry) => (
                      <div key={entry.label}>
                        <p className="mb-2 text-base font-black">
                          {entry.label}
                        </p>
                        <div
                          className={cn(
                            "relative w-full overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-white",
                            aspectClass,
                          )}
                        >
                          <img
                            src={
                              entry.imageUrl ||
                              placeholderImageUrl(
                                `${round.gmTitle}-${entry.label}`,
                              )
                            }
                            alt={entry.label}
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                          {answerBox ? (
                            <span
                              className="absolute border-4 border-[var(--pmb-yellow)] bg-[color:color-mix(in_srgb,var(--pmb-yellow)_18%,transparent)]"
                              style={{
                                left: `${answerBox.x * 100}%`,
                                top: `${answerBox.y * 100}%`,
                                width: `${answerBox.width * 100}%`,
                                height: `${answerBox.height * 100}%`,
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                    <p className="text-xs font-black tracking-[0.16em] uppercase">
                      {copy.results.changeSummary}
                    </p>
                    <p className="mt-2 text-sm font-semibold">
                      {round.reveal?.changeSummary ?? copy.common.none}
                    </p>
                  </div>

                  <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                    <p className="text-xs font-black tracking-[0.16em] uppercase">
                      {copy.results.answerArea}
                    </p>
                    <p className="mt-2 text-sm font-semibold">
                      {answerBox
                        ? `${Math.round(answerBox.x * 100)}%, ${Math.round(answerBox.y * 100)}%`
                        : copy.common.none}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 overflow-hidden lg:border-l-4 lg:border-[var(--pmb-ink)] lg:pl-4">
                <p className="text-base font-black md:text-lg">
                  {copy.results.clickResults}
                </p>
                <div className="mt-3 grid min-h-0 gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                  {sortedChangeResults.map((entry) => (
                    <div
                      key={entry.uid}
                      className={cn(
                        "flex min-h-0 flex-col rounded-lg border-4 border-[var(--pmb-ink)] p-3",
                        entry.hit
                          ? "bg-[var(--pmb-green)]/35"
                          : entry.submitted
                            ? "bg-[var(--pmb-red)]/20"
                            : "bg-[var(--pmb-base)]",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-black">
                          {entry.displayName}
                        </p>
                        {entry.uid === user?.uid ? (
                          <Badge className="bg-white px-2 py-0 text-[10px]">
                            {copy.common.you}
                          </Badge>
                        ) : null}
                        <Badge
                          className={
                            entry.hit
                              ? "bg-[var(--pmb-green)] text-white"
                              : entry.submitted
                                ? "bg-[var(--pmb-red)] text-white"
                                : "bg-white"
                          }
                        >
                          {entry.submitted
                            ? entry.hit
                              ? copy.common.hit
                              : copy.common.miss
                            : copy.common.notSubmitted}
                        </Badge>
                      </div>

                      <div
                        className={cn(
                          "relative mt-3 w-full overflow-hidden rounded-lg border-2 border-[var(--pmb-ink)] bg-white",
                          aspectClass,
                        )}
                      >
                        <img
                          src={
                            changedImageUrl ||
                            placeholderImageUrl(entry.displayName)
                          }
                          alt={entry.displayName}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        {answerBox ? (
                          <span
                            className="absolute border-4 border-[var(--pmb-yellow)] bg-[color:color-mix(in_srgb,var(--pmb-yellow)_18%,transparent)]"
                            style={{
                              left: `${answerBox.x * 100}%`,
                              top: `${answerBox.y * 100}%`,
                              width: `${answerBox.width * 100}%`,
                              height: `${answerBox.height * 100}%`,
                            }}
                          />
                        ) : null}
                        {entry.point ? (
                          <span
                            className={cn(
                              "absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 shadow-[0_0_0_2px_white]",
                              entry.hit
                                ? "border-[var(--pmb-green)] bg-[var(--pmb-green)]"
                                : "border-[var(--pmb-red)] bg-[var(--pmb-red)]",
                            )}
                            style={{
                              left: `${entry.point.x * 100}%`,
                              top: `${entry.point.y * 100}%`,
                            }}
                          />
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-1 text-sm font-semibold">
                        <p>{copy.common.points(entry.score)}</p>
                        <p>
                          {entry.rank
                            ? copy.results.rankLabel(entry.rank)
                            : copy.results.noClick}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  if (isImpostorMode) {
    const accusedUid = round.modeState?.voteTarget ?? null;
    const impostorUid =
      orderedTurnTimeline.find((entry) => entry.role === "impostor")?.uid ??
      null;
    const crewWin =
      !revealLocked &&
      finalSimilarityScore !== null &&
      (finalSimilarityScore >= 70 ||
        (accusedUid !== null && accusedUid === impostorUid));
    const canReturnToLobby = canEnterLobby || canHostReturnRoomToLobby;
    const myVoteTargetUid = voteProgress?.meTargetUid ?? null;
    const useFixedDesktopVoteGrid = orderedTurnTimeline.length <= 6;

    return (
      <main
        className={cn(
          "page-enter mx-auto flex min-h-[100dvh] w-full max-w-[1500px] flex-col overflow-x-hidden px-4 py-4 md:px-6 lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden",
          useFixedDesktopVoteGrid ? "gap-2.5" : "gap-3",
        )}
      >
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-3 shadow-[8px_8px_0_var(--pmb-ink)] md:p-4">
          <div className="min-w-0">
            <p className="text-sm font-black tracking-wide uppercase">
              Round {round.index} Result
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-4xl leading-none md:text-5xl">
                Art Impostor
              </h1>
              <Badge
                className={revealLocked ? "bg-white" : "bg-[var(--pmb-green)]"}
              >
                {revealLocked ? copy.common.voting : copy.common.reveal}
              </Badge>
              <Badge
                className={
                  myRole === "impostor"
                    ? "bg-[var(--pmb-red)] text-white"
                    : "bg-white"
                }
              >
                {myRole === "impostor"
                  ? `${copy.common.you}: ${copy.common.impostor}`
                  : `${copy.common.you}: ${copy.common.agent}`}
              </Badge>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 md:items-end">
            {isFinalRound ? (
              <Badge className="bg-[var(--pmb-red)] text-white">
                <Flag className="mr-1 h-3.5 w-3.5" /> {copy.common.finalRound}
              </Badge>
            ) : null}
            <div className="flex w-full flex-wrap gap-2 md:justify-end">
              {!isFinalRound ? (
                <Button
                  type="button"
                  variant="accent"
                  onClick={onNext}
                  disabled={!me?.isHost || !isResultsPhase || revealLocked}
                >
                  <ChevronRight className="mr-1 h-4 w-4" />
                  {copy.results.nextRound}
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
                {copy.results.backToLobby}
              </Button>
            </div>
            {lobbyBusy ? (
              <p className="text-xs font-semibold">
                {copy.results.returningToLobby}
              </p>
            ) : lobbyHintMessage ? (
              <p className="text-xs font-semibold">
                {lobbyHintMessage}
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
          <Card
            className={cn(
              "flex h-full min-h-0 flex-col overflow-hidden bg-white",
              useFixedDesktopVoteGrid ? "p-3" : "p-3 md:p-4",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 items-start justify-between",
                useFixedDesktopVoteGrid
                  ? "flex-col gap-2.5 lg:flex-row lg:flex-nowrap"
                  : "flex-wrap gap-3",
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-black md:text-lg">
                    {copy.results.votePrompt}
                  </p>
                  <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                    {copy.common.steps(orderedTurnTimeline.length)}
                  </Badge>
                </div>
              </div>

              <div
                className={cn(
                  "grid w-full min-w-0 gap-2 sm:grid-cols-2",
                  useFixedDesktopVoteGrid
                    ? "lg:w-[360px] lg:shrink-0"
                    : "lg:w-auto",
                )}
              >
                <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2">
                  <p className="text-[10px] font-black tracking-[0.16em] uppercase">
                    {copy.results.finalSimilarity}
                  </p>
                  <p className="mt-1 font-mono text-xl font-black md:text-2xl">
                    {finalSimilarityScore ?? "--"} / 100
                  </p>
                </div>
                <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2">
                  <p className="text-[10px] font-black tracking-[0.16em] uppercase">
                    {copy.results.voteProgress}
                  </p>
                  <p className="mt-1 font-mono text-xl font-black md:text-2xl">
                    {voteProgress?.submitted ?? 0} / {voteProgress?.total ?? 0}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold">
                    {myVoteTargetUid
                      ? copy.results.voteSubmitted
                      : copy.results.votePending}
                  </p>
                </div>
              </div>
            </div>

            {voteError ? (
              <p className="mt-2 text-sm font-semibold text-[var(--pmb-red)]">
                {resolveUiErrorMessage(language, voteError)}
              </p>
            ) : null}

            {!revealLocked ? (
              <div
                className={cn(
                  "rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-4 py-3",
                  voteError ? "mt-2" : "mt-2.5",
                )}
              >
                <p className="text-xs font-black tracking-[0.16em] uppercase">
                  {copy.results.outcome}
                </p>
                <p className="mt-1 text-2xl font-black">
                  {crewWin ? copy.results.crewWin : copy.results.impostorWin}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {copy.results.outcomeSummary(
                    finalSimilarityScore ?? "--",
                    accusedUid === null
                      ? copy.results.tiedVote
                      : accusedUid === impostorUid
                        ? copy.results.voteHit
                        : copy.results.voteMiss,
                  )}
                </p>
              </div>
            ) : null}

            <div
              className={cn(
                "min-h-0 flex-1 overflow-hidden",
                revealLocked ? "mt-2.5" : "mt-2",
              )}
            >
              <div
                className={cn(
                  "grid h-full min-h-0",
                  useFixedDesktopVoteGrid
                    ? "gap-2.5 overflow-y-auto pr-1 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2 lg:overflow-hidden lg:pr-0"
                    : "auto-rows-[minmax(0,1fr)] gap-3 overflow-y-auto pr-1 md:grid-cols-2 lg:grid-cols-3",
                )}
              >
                {orderedTurnTimeline.map((entry, index) => {
                  const votedPlayer = !revealLocked
                    ? snapshot.players.find(
                        (player) => player.uid === entry.votedForUid,
                      )
                    : null;
                  const isSelfCard = entry.uid === user?.uid;
                  const isSelectedVote = myVoteTargetUid === entry.uid;

                  return (
                    <div
                      key={`${entry.uid}-${index}`}
                      className={cn(
                        "flex h-full min-h-0 flex-col rounded-lg border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)]",
                        useFixedDesktopVoteGrid ? "p-2.5" : "p-3",
                      )}
                    >
                      <div
                        className={cn(
                          "overflow-hidden rounded border-2 border-[var(--pmb-ink)] bg-white",
                          useFixedDesktopVoteGrid
                            ? "h-28 sm:h-32 lg:h-[min(12vh,126px)]"
                            : "h-32 sm:h-36 xl:h-40",
                        )}
                      >
                        <img
                          src={
                            entry.imageUrl ||
                            placeholderImageUrl(entry.displayName)
                          }
                          alt={entry.displayName}
                          className="h-full w-full object-contain p-1"
                        />
                      </div>

                      <div
                        className={cn(
                          "flex min-h-0 flex-1 flex-col",
                          useFixedDesktopVoteGrid ? "mt-2" : "mt-3",
                        )}
                      >
                        <div
                          className={cn(
                            "flex flex-wrap items-center",
                            useFixedDesktopVoteGrid ? "gap-1.5" : "gap-2",
                          )}
                        >
                          <p
                            className={cn(
                              "min-w-0 flex-1 truncate font-black",
                              useFixedDesktopVoteGrid ? "text-sm" : "",
                            )}
                          >
                            {index + 1}. {entry.displayName}
                          </p>
                          {entry.kind === "cpu" ? (
                            <Badge className="bg-white">
                              {copy.common.cpu}
                            </Badge>
                          ) : null}
                          {entry.uid === user?.uid ? (
                            <Badge className="bg-white">
                              {copy.common.you}
                            </Badge>
                          ) : null}
                          {!revealLocked && entry.role ? (
                            <Badge
                              className={
                                entry.role === "impostor"
                                  ? "bg-[var(--pmb-red)] text-white"
                                  : "bg-[var(--pmb-green)] text-white"
                              }
                            >
                              {entry.role === "impostor"
                                ? copy.common.impostor
                                : copy.common.agent}
                            </Badge>
                          ) : null}
                        </div>

                        <div
                          className={cn(
                            "flex flex-wrap items-center justify-between",
                            useFixedDesktopVoteGrid
                              ? "mt-1.5 gap-1.5"
                              : "mt-2 gap-2",
                          )}
                        >
                          <p
                            className={cn(
                              "font-mono font-black",
                              useFixedDesktopVoteGrid ? "text-base" : "text-lg",
                            )}
                          >
                            {copy.common.points(entry.similarityScore)}
                          </p>
                          {entry.timedOut ? (
                            <Badge className="bg-white px-2 py-0 text-[10px]">
                              {copy.common.timeout}
                            </Badge>
                          ) : null}
                        </div>

                        {revealLocked ? (
                          <div
                            className={cn(
                              "mt-auto",
                              useFixedDesktopVoteGrid ? "pt-2" : "pt-3",
                            )}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={
                                voteBusy ||
                                isSelfCard ||
                                liveRoomStatus !== "RESULTS"
                              }
                              onClick={() => void onVote(entry.uid)}
                              className={cn(
                                "w-full text-sm font-black",
                                useFixedDesktopVoteGrid
                                  ? "px-2 py-2 leading-tight"
                                  : "",
                                isSelfCard
                                  ? "bg-zinc-200 text-zinc-600 disabled:opacity-100 disabled:shadow-[3px_3px_0_var(--pmb-ink)]"
                                  : isSelectedVote
                                    ? "bg-[var(--pmb-red)] text-white"
                                    : "bg-[var(--pmb-yellow)] text-[var(--pmb-ink)]",
                              )}
                            >
                              {isSelfCard
                                ? copy.results.cannotVoteSelf
                                : isSelectedVote
                                  ? copy.results.votingForPlayer
                                  : copy.results.voteForPlayer}
                            </Button>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              "min-h-0 flex-1 overflow-y-auto pr-1 font-semibold",
                              useFixedDesktopVoteGrid
                                ? "mt-1.5 text-[11px] leading-snug"
                                : "mt-2 text-xs",
                            )}
                          >
                            {entry.prompt ? (
                              <div
                                className={cn(
                                  "rounded-lg border-2 border-[var(--pmb-ink)] bg-white",
                                  useFixedDesktopVoteGrid ? "p-1.5" : "p-2",
                                )}
                              >
                                <p className="text-[10px] font-black tracking-wide uppercase">
                                  {copy.common.prompt}
                                </p>
                                <p className="mt-1 leading-relaxed break-words">
                                  {entry.prompt}
                                </p>
                              </div>
                            ) : null}

                            <div className="mt-2 break-words">
                              <p>
                                {copy.common.matched(
                                  (entry.matchedElements ?? []).join(" / ") ||
                                    copy.common.none,
                                )}
                              </p>
                              <p className="mt-1">
                                {copy.common.missing(
                                  (entry.missingElements ?? []).join(" / ") ||
                                    copy.common.none,
                                )}
                              </p>
                              <p className="mt-1">
                                {copy.common.votedFor(
                                  votedPlayer?.displayName ??
                                    (entry.votedForUid
                                      ? entry.votedForUid
                                      : copy.results.unrevealed),
                                )}
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
            <p className="text-sm font-black tracking-wide uppercase">
              {copy.common.roundResult(round.index)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-4xl leading-none md:text-5xl">
                {copy.results.rankingAnnouncement}
              </h1>
              <Badge className="bg-white">{currentMode.label}</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isFinalRound ? (
              <Badge className="bg-[var(--pmb-red)] text-white">
                <Flag className="mr-1 h-3.5 w-3.5" /> {copy.common.finalRound}
              </Badge>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {!isFinalRound ? (
                <Button
                  type="button"
                  variant="accent"
                  onClick={onNext}
                  disabled={!me?.isHost || !isResultsPhase}
                >
                  <ChevronRight className="mr-1 h-4 w-4" />
                  {copy.results.nextRound}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                onClick={onLeave}
                disabled={lobbyBusy || (!canEnterLobby && !canHostReturnRoomToLobby)}
              >
                {lobbyBusy ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {copy.results.backToLobby}
              </Button>
            </div>
            {lobbyHintMessage ? (
              <p className="text-xs font-semibold">{lobbyHintMessage}</p>
            ) : null}
            {!me?.isHost && !isFinalRound ? (
              <p className="text-xs font-semibold">
                {copy.results.hostOnlyNextStep}
              </p>
            ) : null}
            {room.status === "GENERATING_ROUND" && !isFinalRound ? (
              <p className="flex items-center gap-2 text-xs font-semibold">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {copy.results.startingNextRound}
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
                <p className="h-7 text-base font-black md:text-lg">
                  {copy.results.targetImage}
                </p>
                <div className="mt-2 h-[220px] w-full shrink-0 sm:h-[260px] lg:h-[240px] xl:h-[280px]">
                  <img
                    src={
                      round.targetImageUrl ||
                      placeholderImageUrl(
                        round.gmTitle || `round-${round.index}`,
                      )
                    }
                    alt="target"
                    className="h-full w-full rounded-lg border-4 border-[var(--pmb-ink)] bg-white object-contain p-1"
                  />
                </div>
                {round.reveal?.gmPromptPublic ? (
                  <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                    <p className="shrink-0 text-xs font-bold">
                      {copy.results.answerPrompt}
                    </p>
                    <div className="mt-1 h-full max-h-[min(28vh,220px)] overflow-y-auto pr-1">
                      <p className="font-mono text-xs font-semibold break-words">
                        {round.reveal.gmPromptPublic}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 overflow-hidden lg:flex lg:h-full lg:flex-col lg:border-l-4 lg:border-[var(--pmb-ink)] lg:pl-4">
                <p className="h-7 text-base font-black md:text-lg">
                  {copy.results.generatedImages}
                </p>
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
                        {copy.results.showJudgeNotes}
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
                <p className="text-xs font-black tracking-[0.18em] uppercase">
                  {copy.common.judgeNote}
                </p>
                <h2 className="mt-1 text-2xl md:text-3xl">
                  {copy.results.yourJudgeNotes}
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowJudgeReason(false)}
                className="h-11 w-11 p-0"
                aria-label={copy.common.closeJudgeNotes}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-4 max-h-[min(60vh,420px)] overflow-y-auto rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-4 text-sm font-semibold">
              {myLatestAttempt ? (
                <>
                  {myLatestAttempt.matchedElements?.length ? (
                    <p className="text-[var(--pmb-green)]">
                      {copy.common.matched(
                        myLatestAttempt.matchedElements.join(" / "),
                      )}
                    </p>
                  ) : null}
                  {myLatestAttempt.missingElements?.length ? (
                    <p className="mt-1 text-[var(--pmb-red)]">
                      {copy.common.missing(
                        myLatestAttempt.missingElements.join(" / "),
                      )}
                    </p>
                  ) : (
                    <p className="mt-1">{copy.results.noMissing}</p>
                  )}
                </>
              ) : (
                <p>{copy.results.noJudgeNotesYet}</p>
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
