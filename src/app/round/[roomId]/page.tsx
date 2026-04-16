"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { EyeOff, LoaderCircle, LogOut, Send } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { CountdownTimer } from "@/components/game/countdown-timer";
import { Scoreboard } from "@/components/game/scoreboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/client/api";
import { createEndRoundRetrier } from "@/lib/client/end-round-retry";
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
  type RoundData,
  type ScoreEntry,
  useRoomSync,
} from "@/lib/client/room-sync";
import {
  MEMORY_PREVIEW_SECONDS,
  getGameModeDefinition,
  isPostDeadlineGraceActive,
  RESULTS_GRACE_SECONDS,
} from "@/lib/game/modes";
import { formatSeconds, millisecondsLeft, parseDate } from "@/lib/utils/time";

type SubmitResponse = Record<string, unknown> & {
  ok: true;
  score: number;
  imageUrl: string;
};

type EndRoundResponse = {
  ok: true;
  status: "IN_ROUND" | "RESULTS";
  consumedDraft?: boolean;
};

export default function RoundPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();

  const { language, copy } = useLanguage();
  const { user } = useAuth();
  const { snapshot } = useRoomSync({
    roomId,
    view: "round",
    enabled: Boolean(user),
  });

  const [room, setRoom] = useState<RoomData | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [attempts, setAttempts] = useState<AttemptData | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState<UiError | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [previewSecondsLeft, setPreviewSecondsLeft] = useState<number | null>(
    null,
  );
  const [resultCountdownSeconds, setResultCountdownSeconds] = useState<
    number | null
  >(null);

  const endCalled = useRef(false);
  const endRoundRetrier = useRef<ReturnType<
    typeof createEndRoundRetrier
  > | null>(null);
  const derivedRoom = snapshot.room as RoomData | null;
  const derivedRound = snapshot.round as RoundData | null;
  const derivedScores = snapshot.scores as ScoreEntry[];
  const derivedAttempts = snapshot.attempts as AttemptData | null;
  const derivedPlayers = snapshot.players as PlayerData[];
  const derivedPlayerCount = snapshot.playerCount || snapshot.players.length;

  const applyImageFallback = (element: HTMLImageElement, label: string) => {
    if (element.dataset.fallbackApplied === "true") return;
    element.dataset.fallbackApplied = "true";
    element.src = placeholderImageUrl(label);
  };

  useEffect(() => {
    setRoom(derivedRoom);
    setRound(derivedRound);
    setScores(derivedScores);
    setAttempts(derivedAttempts);
    setPlayerCount(derivedPlayerCount);
  }, [
    derivedAttempts,
    derivedPlayerCount,
    derivedRound,
    derivedRoom,
    derivedScores,
  ]);

  const currentGameMode = room?.settings?.gameMode ?? "classic";
  const currentMode = getGameModeDefinition(currentGameMode, language);
  const impostorModeState =
    currentGameMode === "impostor" && round?.modeState?.kind === "impostor"
      ? round.modeState
      : null;
  const isImpostorMode = Boolean(impostorModeState);
  const isMyTurn = Boolean(snapshot.isMyTurn);
  const myRole = snapshot.myRole;
  const currentTurnUid =
    snapshot.currentTurnUid ?? impostorModeState?.currentTurnUid ?? null;
  const currentTurnPlayer =
    derivedPlayers.find((player) => player.uid === currentTurnUid) ?? null;
  const isCpuTurn = Boolean(
    isImpostorMode && currentTurnPlayer?.kind === "cpu",
  );
  const currentTurnName =
    currentTurnPlayer?.displayName ??
    (isCpuTurn ? copy.common.cpu : copy.common.otherPlayer);
  const completedTurns =
    impostorModeState?.phase === "CHAIN"
      ? (impostorModeState.currentTurnIndex ?? 0)
      : (impostorModeState?.turnOrder?.length ?? 0);
  const turnTotal = impostorModeState?.turnOrder?.length ?? 0;
  const roundSeconds = room?.settings?.roundSeconds ?? 60;

  useEffect(() => {
    if (!round || !room) {
      setSecondsLeft(0);
      setPreviewSecondsLeft(null);
      return;
    }

    if (
      isImpostorMode &&
      room.status === "IN_ROUND" &&
      round.status === "IN_ROUND" &&
      isCpuTurn
    ) {
      setSecondsLeft(0);
      setPreviewSecondsLeft(null);
      return;
    }

    if (
      room.status !== "IN_ROUND" ||
      round.status !== "IN_ROUND" ||
      !round.endsAt
    ) {
      setSecondsLeft(roundSeconds);
      setPreviewSecondsLeft(null);
      return;
    }

    const update = () => {
      const promptStartsAt = parseDate(round.promptStartsAt);
      if (
        currentGameMode === "memory" &&
        promptStartsAt &&
        Date.now() < promptStartsAt.getTime()
      ) {
        setPreviewSecondsLeft(
          Math.max(
            0,
            Math.ceil((promptStartsAt.getTime() - Date.now()) / 1000),
          ),
        );
        setSecondsLeft(roundSeconds);
        return;
      }

      setPreviewSecondsLeft(null);
      setSecondsLeft(Math.ceil(millisecondsLeft(round.endsAt) / 1000));
    };

    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [currentGameMode, isCpuTurn, isImpostorMode, round, room, roundSeconds]);

  useEffect(() => {
    endCalled.current = false;
    endRoundRetrier.current?.cancel();
    endRoundRetrier.current = null;
  }, [currentTurnUid, round?.endsAt, round?.roundId, room?.status]);

  useEffect(() => {
    if (!room || !round) return;

    if (room.status === "RESULTS") {
      router.replace(buildCurrentAppPath(`/results/${roomId}`));
      return;
    }

    if (room.status === "LOBBY") {
      router.replace(buildCurrentAppPath(`/lobby/${roomId}`));
      return;
    }

    if (room.status === "FINISHED") {
      router.replace(buildCurrentAppPath("/"));
      return;
    }
  }, [room?.status, round?.status, roomId, router]);

  useEffect(() => {
    if (!room || !round) return;
    if (room.status !== "IN_ROUND" || round.status !== "IN_ROUND") return;
    if (isCpuTurn || !round.endsAt) return;
    if (secondsLeft > 0 || endCalled.current) return;

    endCalled.current = true;
    const timeoutDraftPrompt =
      !submitPending && prompt.trim().length > 0 ? prompt : undefined;
    const retrier = createEndRoundRetrier({
      runEndIfNeeded: () =>
        apiPost<EndRoundResponse>(
          "/api/rounds/endIfNeeded",
          {
            roomId,
            roundId: round.roundId,
            ...(timeoutDraftPrompt ? { draftPrompt: timeoutDraftPrompt } : {}),
          },
        ).then((result) => {
          if (result.consumedDraft) {
            setPrompt("");
            setFeedback(null);
          }
          return result;
        }),
      onError: (err) => {
        console.error("endIfNeeded failed", err);
        endCalled.current = false;
      },
    });

    endRoundRetrier.current = retrier;
    void retrier.run();

    return () => {
      if (endRoundRetrier.current === retrier) {
        retrier.cancel();
        endRoundRetrier.current = null;
      }
    };
  }, [
    isCpuTurn,
    secondsLeft,
    room?.status,
    round?.status,
    round?.endsAt,
    round?.roundId,
    roomId,
    prompt,
    submitPending,
  ]);

  const latestAttempt =
    attempts?.attempts?.[attempts.attempts.length - 1] ?? null;
  const attemptsLeft = Math.max(
    0,
    (room?.settings?.maxAttempts ?? 0) - (attempts?.attemptsUsed ?? 0),
  );
  const isRoundLive =
    room?.status === "IN_ROUND" && round?.status === "IN_ROUND";
  const isBusy = submitPending;
  const otherBestImages = scores.filter(
    (entry) => entry.uid !== user?.uid && entry.bestImageUrl,
  );
  const latestAttemptScoring = Boolean(
    latestAttempt &&
    (latestAttempt.status === "SCORING" || latestAttempt.score == null),
  );
  const hasGeneratedImage = Boolean(
    attempts?.attempts?.some((attempt) => attempt.imageUrl.trim().length > 0),
  );
  const everyoneScored = playerCount > 0 && scores.length >= playerCount;
  const postDeadlineGraceActive =
    isRoundLive &&
    isPostDeadlineGraceActive({
      promptStartsAt: round?.promptStartsAt,
      endsAt: round?.endsAt,
      roundSeconds,
    });
  const autoEndingSoon =
    isRoundLive && (everyoneScored || postDeadlineGraceActive);
  const visibleSecondsLeft = autoEndingSoon ? 0 : secondsLeft;
  const isPreviewPhase =
    currentGameMode === "memory" &&
    isRoundLive &&
    previewSecondsLeft !== null &&
    previewSecondsLeft > 0;
  const promptLocked = isPreviewPhase;
  const shouldShowTargetImage =
    currentGameMode === "classic" || isPreviewPhase || hasGeneratedImage;
  const imageFrameClass =
    "relative h-64 w-full overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-white sm:h-72 lg:h-[min(34vh,320px)]";
  const impostorReferenceImageUrl =
    impostorModeState?.chainImageUrl || round?.targetImageUrl || "";

  useEffect(() => {
    if (!autoEndingSoon) {
      setResultCountdownSeconds(null);
      return;
    }

    const parsedEndsAt = parseDate(round?.endsAt);
    const fallbackEndsAt = new Date(
      Date.now() + RESULTS_GRACE_SECONDS * 1000,
    );
    const countdownTarget =
      parsedEndsAt && parsedEndsAt.getTime() > Date.now()
        ? parsedEndsAt
        : fallbackEndsAt;

    const update = () => {
      const leftSeconds = Math.max(
        0,
        Math.ceil((countdownTarget.getTime() - Date.now()) / 1000),
      );
      setResultCountdownSeconds(leftSeconds);
    };

    update();
    const intervalId = setInterval(update, 250);
    return () => clearInterval(intervalId);
  }, [autoEndingSoon, round?.endsAt]);

  useEffect(() => {
    if (!room || !round) return;
    if (room.status !== "IN_ROUND" || round.status !== "IN_ROUND") return;
    if (!everyoneScored) return;

    const timeoutId = setTimeout(() => {
      void apiPost("/api/rounds/endIfNeeded", {
        roomId,
        roundId: round.roundId,
      }).catch((err) => {
        console.error("auto endIfNeeded failed", err);
      });
    }, 10_500);

    return () => clearTimeout(timeoutId);
  }, [everyoneScored, room, round, roomId]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user),
  });

  const submitPrompt = async () => {
    if (!round || !prompt.trim() || promptLocked) return;

    setSubmitPending(true);
    setFeedback(null);

    try {
      await apiPost<SubmitResponse>("/api/rounds/submit", {
        roomId,
        roundId: round.roundId,
        prompt,
      });

      setPrompt("");
      setFeedback(null);
    } catch (e) {
      setFeedback(toUiError(e, "submitPromptFailed"));
    } finally {
      setSubmitPending(false);
    }
  };

  const onBackToLobby = () => {
    router.push(buildCurrentAppPath(`/results/${roomId}?from=round`));
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">{copy.round.loading}</Card>
      </main>
    );
  }

  if (isImpostorMode) {
    const primaryImageUrl = isMyTurn ? impostorReferenceImageUrl : "";
    const primaryImageHeading = isMyTurn
      ? copy.round.referenceImage
      : copy.round.hidden;
    const primaryImageDescription = isMyTurn
      ? copy.round.referenceDescription
      : isCpuTurn
        ? copy.round.cpuPassMessage
        : copy.round.hiddenImageDescription;

    return (
      <main className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 md:px-6 lg:h-screen lg:max-h-screen lg:overflow-hidden">
        <Card className="bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl leading-none font-black uppercase md:text-3xl">
                  Round {round.index}
                </p>
                <Badge className="bg-[var(--pmb-yellow)] text-[var(--pmb-ink)]">
                  Art Impostor
                </Badge>
                <Badge
                  className={
                    myRole === "impostor"
                      ? "bg-[var(--pmb-red)] text-white"
                      : ""
                  }
                >
                  {myRole === "impostor"
                    ? copy.common.impostor
                    : copy.common.agent}
                </Badge>
              </div>
              <p className="mt-2 text-sm font-semibold">
                {isMyTurn
                  ? copy.round.yourTurnMessage
                  : isCpuTurn
                    ? copy.round.cpuTurnMessage(currentTurnName)
                    : copy.round.waitingTurnMessage(currentTurnName)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isCpuTurn ? (
                <Card className="bg-[var(--pmb-blue)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                  <p className="text-xs font-black tracking-[0.18em] uppercase">
                    CPU Generating
                  </p>
                  <p className="mt-1 text-sm font-black">
                    {copy.round.cpuGeneratingShort}
                  </p>
                </Card>
              ) : (
                <CountdownTimer secondsLeft={secondsLeft} />
              )}
              <Card className="bg-[var(--pmb-base)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                <p className="text-xs font-black tracking-[0.18em] uppercase">
                  {copy.round.turnProgress}
                </p>
                <p className="mt-1 font-mono text-2xl font-black">
                  {completedTurns}/{turnTotal}
                </p>
              </Card>
            </div>
          </div>

          <h2 className="mt-4 mb-2 text-lg">
            {isMyTurn ? copy.round.promptInputTitle : copy.round.waitingTitle}
          </h2>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              isMyTurn
                ? copy.round.promptPlaceholder
                : copy.round.promptDisabledPlaceholder
            }
            maxLength={600}
            className="min-h-20"
            disabled={!isMyTurn || !isRoundLive || isBusy}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
            <Button
              type="button"
              onClick={submitPrompt}
              disabled={
                isBusy || !isRoundLive || !isMyTurn || prompt.trim().length < 1
              }
            >
              {submitPending ? (
                <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              {submitPending
                ? copy.round.evaluating
                : isMyTurn
                  ? copy.round.generateNextImage
                  : copy.round.waitingTurn}
            </Button>
            <Card className="bg-[var(--pmb-base)] px-3 py-2 text-center text-sm font-semibold shadow-[4px_4px_0_var(--pmb-ink)]">
              {copy.common.currentTurn(
                currentTurnPlayer?.displayName ?? copy.common.idle,
              )}
            </Card>
          </div>
          {feedback ? (
            <p className="mt-2 text-sm font-semibold text-[var(--pmb-red)]">
              {resolveUiErrorMessage(language, feedback)}
            </p>
          ) : null}
        </Card>

        <section className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_0.95fr]">
          <Card className="bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base">{primaryImageHeading}</h3>
              <Badge className="bg-white px-2 py-0 text-[10px]">
                {completedTurns}/{turnTotal} DONE
              </Badge>
            </div>
            {primaryImageUrl ? (
              <div className={imageFrameClass}>
                <img
                  src={
                    primaryImageUrl ||
                    placeholderImageUrl(round.gmTitle || "reference")
                  }
                  alt={primaryImageHeading}
                  className="h-full w-full object-contain p-1"
                  onError={(event) =>
                    applyImageFallback(
                      event.currentTarget,
                      round.gmTitle || "reference",
                    )
                  }
                />
              </div>
            ) : (
              <div
                className={`${imageFrameClass} flex flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,var(--pmb-base),white)] p-6 text-center`}
              >
                <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-5 py-3 text-sm font-black tracking-[0.16em] uppercase">
                  {copy.round.hiddenWaiting}
                </div>
                <p className="text-lg font-black">
                  {copy.round.hiddenImageMessage(currentTurnName)}
                </p>
                <p className="max-w-md text-sm font-semibold">
                  {isCpuTurn
                    ? copy.round.cpuPassMessage
                    : copy.round.hiddenImageDescription}
                </p>
              </div>
            )}
            <div className="mt-3 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3 text-sm font-semibold">
              <p>{primaryImageDescription}</p>
              {!isMyTurn ? (
                <p className="mt-2">
                  {copy.common.currentTurnWithColon(
                    currentTurnPlayer?.displayName ?? copy.common.idle,
                  )}
                </p>
              ) : null}
            </div>
          </Card>

          <div className="flex min-h-0 flex-col gap-3">
            <Card className="min-h-0 bg-white p-3 lg:flex lg:h-full lg:flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base">{copy.round.turnOrder}</h3>
                <p className="text-xs font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_65%,white)]">
                  {copy.round.turnOrderHint}
                </p>
              </div>
              <div className="mt-3 min-h-0 space-y-2 overflow-y-auto pr-1">
                {impostorModeState?.turnOrder?.map((turnUid, index) => {
                  const player = derivedPlayers.find(
                    (candidate) => candidate.uid === turnUid,
                  );
                  const isCurrent = turnUid === currentTurnUid;
                  const isDone = index < completedTurns;

                  return (
                    <div
                      key={turnUid}
                      className={[
                        "rounded-lg border-2 border-[var(--pmb-ink)] px-3 py-3",
                        isCurrent
                          ? "bg-[var(--pmb-yellow)]"
                          : isDone
                            ? "bg-[var(--pmb-green)]"
                            : "bg-[var(--pmb-base)]",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-black">
                            {index + 1}. {player?.displayName ?? turnUid}
                          </p>
                          {player?.kind === "cpu" ? (
                            <Badge className="bg-white px-2 py-0 text-[10px]">
                              {copy.common.cpu}
                            </Badge>
                          ) : null}
                          {player?.uid === user?.uid ? (
                            <Badge className="bg-white px-2 py-0 text-[10px]">
                              {copy.common.you}
                            </Badge>
                          ) : null}
                          <Badge className="bg-white px-2 py-0 text-[10px]">
                            {isCurrent
                              ? copy.common.now
                              : isDone
                                ? copy.common.done
                                : copy.common.wait}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-start gap-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-white/80 px-3 py-2 text-xs font-semibold">
                          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" />
                          <p>
                            {isCurrent
                              ? copy.round.currentTurnOnly
                              : isDone
                                ? copy.round.revealedInResults
                                : copy.round.hiddenUntilTurn}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 md:px-6 lg:h-screen lg:max-h-screen lg:overflow-hidden">
      <Card className="bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-2xl leading-none font-black uppercase md:text-3xl">
                Round {round.index}
              </p>
              <Badge
                className={
                  currentGameMode === "memory" ? "bg-[var(--pmb-blue)]" : ""
                }
              >
                {currentMode.label}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isPreviewPhase ? (
              <Card className="bg-[var(--pmb-blue)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                <p className="text-xs font-black tracking-[0.18em] uppercase">
                  {copy.round.memoryPreview}
                </p>
                <p className="mt-1 font-mono text-2xl font-black">
                  {formatSeconds(previewSecondsLeft ?? MEMORY_PREVIEW_SECONDS)}
                </p>
              </Card>
            ) : (
              <CountdownTimer secondsLeft={visibleSecondsLeft} />
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={onBackToLobby}
              disabled={isBusy || (isRoundLive && !autoEndingSoon)}
              className={
                autoEndingSoon
                  ? "animate-pulse bg-[var(--pmb-yellow)] font-mono text-base font-black"
                  : ""
              }
            >
              <LogOut className="mr-2 h-4 w-4" />
              {autoEndingSoon
                ? copy.round.resultsScreenCountdown(
                    resultCountdownSeconds ?? RESULTS_GRACE_SECONDS,
                  )
                : copy.round.resultsScreen}
            </Button>
          </div>
        </div>
        <h2 className="mt-4 mb-2 text-lg">{copy.round.memoryPromptTitle}</h2>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            isPreviewPhase
              ? copy.round.memoryLockedPlaceholder
              : copy.round.promptExample
          }
          maxLength={600}
          className="min-h-20"
          disabled={promptLocked || !isRoundLive || attemptsLeft <= 0 || isBusy}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
          <Button
            type="button"
            onClick={submitPrompt}
            disabled={
              isBusy ||
              !isRoundLive ||
              attemptsLeft <= 0 ||
              prompt.trim().length < 1 ||
              promptLocked
            }
          >
            {submitPending ? (
              <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {submitPending
              ? copy.round.evaluating
              : isPreviewPhase
                ? copy.round.waitingForMemory
                : copy.round.generateImage}
          </Button>
          <Card className="bg-[var(--pmb-base)] px-3 py-2 text-center text-sm font-semibold shadow-[4px_4px_0_var(--pmb-ink)]">
            {copy.round.attemptsLeft(attemptsLeft)}
          </Card>
        </div>
        {feedback ? (
          <p className="mt-2 text-sm font-semibold text-[var(--pmb-red)]">
            {resolveUiErrorMessage(language, feedback)}
          </p>
        ) : null}
        {!isRoundLive ? (
          <p className="mt-2 text-sm font-semibold">
            {copy.round.roundPreparing}
          </p>
        ) : null}
      </Card>

      <section className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1fr_0.95fr]">
        <Card className="bg-white p-3">
          <h3 className="mb-2 text-base">{copy.round.targetImage}</h3>
          {shouldShowTargetImage ? (
            round.targetImageUrl ? (
              <div className={imageFrameClass}>
                <img
                  src={
                    round.targetImageUrl ||
                    placeholderImageUrl(round.gmTitle || "target")
                  }
                  alt="target"
                  className="h-full w-full object-contain p-1"
                  onError={(event) =>
                    applyImageFallback(
                      event.currentTarget,
                      round.gmTitle || "target",
                    )
                  }
                />
              </div>
            ) : (
              <div
                className={`${imageFrameClass} flex items-center justify-center border-dashed bg-[var(--pmb-base)] p-4 text-center text-sm font-semibold`}
              >
                {copy.round.syncingTargetImage}
              </div>
            )
          ) : (
            <div
              className={`${imageFrameClass} flex flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,var(--pmb-base),white)] p-6 text-center`}
            >
              <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4">
                <EyeOff className="h-8 w-8" />
              </div>
              <p className="text-lg font-black">{copy.round.memoryOnly}</p>
            </div>
          )}
        </Card>

        <Card className="bg-white p-3">
          <h3 className="mb-2 text-base">{copy.round.generatedImage}</h3>
          {latestAttempt ? (
            <div className="space-y-2">
              <div className={imageFrameClass}>
                <img
                  src={
                    latestAttempt.imageUrl ||
                    placeholderImageUrl(latestAttempt.prompt)
                  }
                  alt="latest attempt"
                  className="h-full w-full object-contain p-1"
                  onError={(event) =>
                    applyImageFallback(
                      event.currentTarget,
                      latestAttempt.prompt,
                    )
                  }
                />
                {latestAttemptScoring ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                    <p className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold">
                      <LoaderCircle className="h-4 w-4 animate-spin" />{" "}
                      {copy.round.scoring}
                    </p>
                  </div>
                ) : null}
                {!latestAttemptScoring &&
                typeof latestAttempt.score === "number" ? (
                  <p className="absolute top-2 right-2 rounded-md border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-1 font-mono text-sm font-black">
                    {latestAttempt.score} pts
                  </p>
                ) : null}
              </div>
              <Card className="h-28 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold">
                <p>{copy.common.judgeNote}</p>
                {!latestAttemptScoring &&
                latestAttempt.matchedElements?.length ? (
                  <p className="mt-1 text-[var(--pmb-green)]">
                    {copy.common.matched(
                      latestAttempt.matchedElements.join(" / "),
                    )}
                  </p>
                ) : null}
                {!latestAttemptScoring &&
                latestAttempt.missingElements?.length ? (
                  <p className="mt-1 text-[var(--pmb-red)]">
                    {copy.common.missing(
                      latestAttempt.missingElements.join(" / "),
                    )}
                  </p>
                ) : null}
                {!latestAttemptScoring && latestAttempt.judgeNote ? (
                  <p className="mt-1">{latestAttempt.judgeNote}</p>
                ) : null}
                {latestAttemptScoring ? (
                  <p className="mt-1">{copy.round.judgeNotesAfterScoring}</p>
                ) : null}
              </Card>
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className={`${imageFrameClass} flex items-center justify-center border-dashed bg-[var(--pmb-base)] p-4 text-sm font-semibold`}
              >
                {copy.round.noImageYet}
              </div>
              <Card className="h-28 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold">
                <p>{copy.common.judgeNote}</p>
                <p className="mt-1">{copy.round.judgeNotesAfterGeneration}</p>
              </Card>
            </div>
          )}
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <Scoreboard entries={scores} myUid={user?.uid} />

          <Card className="min-h-0 bg-white p-3">
            <h3 className="mb-2 text-sm">{copy.round.everyoneBestImages}</h3>
            {otherBestImages.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {otherBestImages.map((entry) => (
                  <div
                    key={entry.uid}
                    className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-2"
                  >
                    <p className="mb-1 truncate text-xs font-bold">
                      {entry.displayName} ({entry.bestScore} pts)
                    </p>
                    <img
                      src={
                        entry.bestImageUrl ||
                        placeholderImageUrl(entry.displayName)
                      }
                      alt={`${entry.displayName} best`}
                      className="aspect-square w-full rounded border-2 border-[var(--pmb-ink)] bg-white object-contain p-1"
                      onError={(event) =>
                        applyImageFallback(
                          event.currentTarget,
                          entry.displayName,
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold">
                {copy.round.waitingForOthers}
              </p>
            )}
          </Card>
        </div>
      </section>
    </main>
  );
}
