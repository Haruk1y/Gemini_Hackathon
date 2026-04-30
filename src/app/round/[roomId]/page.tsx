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
import {
  mapContainedFramePointToImagePoint,
  projectImagePointToContainedFrame,
  type FrameSize,
} from "@/lib/client/image-coordinate";
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
  CHANGE_ANSWER_SECONDS,
  CHANGE_DEFAULT_ROUND_SECONDS,
  CHANGE_RESET_SECONDS,
  CHANGE_ROUND_SECONDS_OPTIONS,
  CHANGE_TRANSITION_SECONDS,
  CHANGE_WAIT_SECONDS,
  MEMORY_PREVIEW_SECONDS,
  getGameModeDefinition,
  getChangeViewCountForRoundSeconds,
  isPostDeadlineGraceActive,
  RESULTS_GRACE_SECONDS,
} from "@/lib/game/modes";
import { formatSeconds, millisecondsLeft, parseDate } from "@/lib/utils/time";

type SubmitResponse = Record<string, unknown> & {
  ok: true;
  score: number;
  imageUrl: string;
};

type ClickResponse = {
  ok: true;
  hit: boolean;
  score: number;
  rank: number | null;
  submittedCount: number;
  correctCount: number;
};

type EndRoundResponse = {
  ok: true;
  status: "IN_ROUND" | "RESULTS";
  consumedDraft?: boolean;
};

type GeneratedImagePhase = "IDLE" | "GENERATING" | "SCORING" | "DONE";
type ChangeTimelinePhase = "waiting" | "changing" | "answer";

function resolveAspectRatioValue(aspectRatio?: "1:1" | "16:9" | "9:16") {
  if (aspectRatio === "16:9") return 16 / 9;
  if (aspectRatio === "9:16") return 9 / 16;
  return 1;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function resolveChangeTimeline(
  promptStartsAt: unknown,
  totalRoundSeconds = CHANGE_DEFAULT_ROUND_SECONDS,
  nowMs = Date.now(),
) {
  const promptStart = parseDate(promptStartsAt);
  const requestedSeconds = Number.isFinite(totalRoundSeconds)
    ? totalRoundSeconds
    : CHANGE_DEFAULT_ROUND_SECONDS;
  const isSupportedChangeDuration = CHANGE_ROUND_SECONDS_OPTIONS.some(
    (value) => value === requestedSeconds,
  );
  const legacyViewCount = requestedSeconds / CHANGE_DEFAULT_ROUND_SECONDS;
  const isLegacyChangeDuration =
    Number.isInteger(legacyViewCount) &&
    legacyViewCount >= 1 &&
    legacyViewCount <= 3;
  const totalSeconds =
    isSupportedChangeDuration || isLegacyChangeDuration
      ? requestedSeconds
      : CHANGE_DEFAULT_ROUND_SECONDS;
  const viewCount = getChangeViewCountForRoundSeconds(totalSeconds);
  const expectedTotalSeconds =
    viewCount * CHANGE_DEFAULT_ROUND_SECONDS +
    Math.max(0, viewCount - 1) * CHANGE_RESET_SECONDS;
  const resetSeconds =
    viewCount > 1 && totalSeconds === expectedTotalSeconds
      ? CHANGE_RESET_SECONDS
      : 0;
  const elapsedSeconds = promptStart
    ? Math.max(0, (nowMs - promptStart.getTime()) / 1000)
    : 0;
  const clampedElapsedSeconds = Math.min(elapsedSeconds, totalSeconds);
  const viewSegmentSeconds = CHANGE_DEFAULT_ROUND_SECONDS + resetSeconds;
  const segmentIndex = Math.min(
    viewCount - 1,
    Math.floor(clampedElapsedSeconds / viewSegmentSeconds),
  );
  const segmentElapsedSeconds =
    clampedElapsedSeconds - segmentIndex * viewSegmentSeconds;
  const isResetting =
    resetSeconds > 0 &&
    segmentIndex < viewCount - 1 &&
    segmentElapsedSeconds >= CHANGE_DEFAULT_ROUND_SECONDS;
  const viewIndex = isResetting ? segmentIndex + 1 : segmentIndex;
  const viewElapsedSeconds = isResetting
    ? 0
    : Math.min(segmentElapsedSeconds, CHANGE_DEFAULT_ROUND_SECONDS);
  const changeStartSeconds = CHANGE_WAIT_SECONDS;
  const changeEndSeconds = CHANGE_WAIT_SECONDS + CHANGE_TRANSITION_SECONDS;
  const phase: ChangeTimelinePhase =
    viewElapsedSeconds < changeStartSeconds
      ? "waiting"
      : viewElapsedSeconds < changeEndSeconds
        ? "changing"
        : "answer";
  const markerPercents = [
    {
      view: viewIndex + 1,
      changeStart: (changeStartSeconds / CHANGE_DEFAULT_ROUND_SECONDS) * 100,
      changeEnd: (changeEndSeconds / CHANGE_DEFAULT_ROUND_SECONDS) * 100,
    },
  ];

  return {
    phase,
    currentView: viewIndex + 1,
    viewCount,
    isResetting,
    viewProgress: clamp01(viewElapsedSeconds / CHANGE_DEFAULT_ROUND_SECONDS),
    changeProgress: clamp01(
      (viewElapsedSeconds - changeStartSeconds) / CHANGE_TRANSITION_SECONDS,
    ),
    markerPercents,
  };
}

function fitStageToContainer(
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number,
) {
  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return null;
  }

  const widthFromHeight = containerHeight * aspectRatio;
  if (widthFromHeight <= containerWidth) {
    return {
      width: widthFromHeight,
      height: containerHeight,
    };
  }

  return {
    width: containerWidth,
    height: containerWidth / aspectRatio,
  };
}

function resolveImageAspectRatio(element: HTMLImageElement) {
  if (element.naturalWidth <= 0 || element.naturalHeight <= 0) {
    return null;
  }

  const aspectRatio = element.naturalWidth / element.naturalHeight;
  return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : null;
}

function resolveGeneratedImagePhase(
  attempt: AttemptData["attempts"][number] | null,
): GeneratedImagePhase {
  if (!attempt) {
    return "IDLE";
  }

  if (attempt.status === "DONE") {
    return "DONE";
  }

  if (attempt.status === "SCORING") {
    return "SCORING";
  }

  if (attempt.status === "GENERATING") {
    return "GENERATING";
  }

  const hasImageUrl = attempt.imageUrl.trim().length > 0;
  if (hasImageUrl) {
    return attempt.score == null ? "SCORING" : "DONE";
  }

  return attempt.score == null ? "GENERATING" : "DONE";
}

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
  const [changeTimelineNowMs, setChangeTimelineNowMs] = useState(() =>
    Date.now(),
  );
  const [previewSecondsLeft, setPreviewSecondsLeft] = useState<number | null>(
    null,
  );
  const [resultCountdownSeconds, setResultCountdownSeconds] = useState<
    number | null
  >(null);
  const [manualResultsPending, setManualResultsPending] = useState(false);
  const [localSelectedPoint, setLocalSelectedPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [changeClickFrameSize, setChangeClickFrameSize] =
    useState<FrameSize | null>(null);

  const endCalled = useRef(false);
  const changeStageContainerRef = useRef<HTMLDivElement | null>(null);
  const changeStageRef = useRef<HTMLDivElement | null>(null);
  const resultCountdownFallbackTargetRef = useRef<number | null>(null);
  const endRoundRetrier = useRef<ReturnType<
    typeof createEndRoundRetrier
  > | null>(null);
  const [changeStageSize, setChangeStageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [changeImageAspectRatio, setChangeImageAspectRatio] = useState<
    number | null
  >(null);
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

  const updateChangeImageAspectRatio = (element: HTMLImageElement) => {
    const nextAspectRatio = resolveImageAspectRatio(element);
    if (!nextAspectRatio) return;

    setChangeImageAspectRatio((previous) => {
      if (previous && Math.abs(previous - nextAspectRatio) < 0.001) {
        return previous;
      }

      return nextAspectRatio;
    });
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
  const changeModeState =
    currentGameMode === "change" && round?.modeState?.kind === "change"
      ? round.modeState
      : null;
  const isChangeMode = Boolean(changeModeState);
  const isImpostorMode = Boolean(impostorModeState);
  const isMyTurn = Boolean(snapshot.isMyTurn);
  const mySubmission = snapshot.mySubmission;
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
  const humanPlayerCount = derivedPlayers.filter(
    (player) => player.kind === "human",
  ).length;
  const completedTurns =
    impostorModeState?.phase === "CHAIN"
      ? (impostorModeState.currentTurnIndex ?? 0)
      : (impostorModeState?.turnOrder?.length ?? 0);
  const turnTotal = impostorModeState?.turnOrder?.length ?? 0;
  const roundSeconds = room?.settings?.roundSeconds ?? 60;
  const changeSubmittedCount = changeModeState?.submittedCount ?? 0;
  const changeCorrectCount = changeModeState?.correctCount ?? 0;
  const changeStageAspectRatio =
    changeImageAspectRatio ??
    resolveAspectRatioValue(room?.settings?.aspectRatio);

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
    resultCountdownFallbackTargetRef.current = null;
    setLocalSelectedPoint(null);
    setChangeClickFrameSize(null);
  }, [currentTurnUid, round?.endsAt, round?.roundId, room?.status]);

  useEffect(() => {
    setChangeImageAspectRatio(null);
  }, [changeModeState?.changedImageUrl, round?.roundId, round?.targetImageUrl]);

  useEffect(() => {
    if (!isChangeMode) {
      setChangeStageSize(null);
      return;
    }

    const container = changeStageContainerRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const fitted = fitStageToContainer(
        rect.width,
        rect.height,
        changeStageAspectRatio,
      );

      setChangeStageSize((previous) => {
        if (!fitted) {
          return null;
        }

        if (
          previous &&
          Math.abs(previous.width - fitted.width) < 1 &&
          Math.abs(previous.height - fitted.height) < 1
        ) {
          return previous;
        }

        return fitted;
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    observer?.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
    };
  }, [changeStageAspectRatio, isChangeMode, round?.roundId]);

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

  const latestAttempt =
    attempts?.attempts?.[attempts.attempts.length - 1] ?? null;
  const latestAttemptPhase = resolveGeneratedImagePhase(latestAttempt);
  const effectiveGeneratedImagePhase =
    submitPending &&
    (latestAttemptPhase === "IDLE" || latestAttemptPhase === "DONE")
      ? "GENERATING"
      : latestAttemptPhase;
  const latestAttemptImageUrl = latestAttempt?.imageUrl.trim() ?? "";
  const hasLatestAttemptImage = latestAttemptImageUrl.length > 0;
  const showGeneratedImagePreview =
    hasLatestAttemptImage &&
    (effectiveGeneratedImagePhase === "SCORING" ||
      effectiveGeneratedImagePhase === "DONE");
  const generatedImageStatusLabel =
    effectiveGeneratedImagePhase === "SCORING"
      ? copy.round.scoring
      : copy.round.generatingImage;
  const attemptsLeft = Math.max(
    0,
    (room?.settings?.maxAttempts ?? 0) - (attempts?.attemptsUsed ?? 0),
  );
  const isRoundLive =
    room?.status === "IN_ROUND" && round?.status === "IN_ROUND";
  const isBusy = submitPending || manualResultsPending;

  useEffect(() => {
    if (!isChangeMode || !isRoundLive) {
      setChangeTimelineNowMs(Date.now());
      return;
    }

    const update = () => setChangeTimelineNowMs(Date.now());
    update();
    const intervalId = window.setInterval(update, 50);
    return () => window.clearInterval(intervalId);
  }, [isChangeMode, isRoundLive, round?.promptStartsAt, round?.roundId]);

  const otherBestImages = scores.filter(
    (entry) => entry.uid !== user?.uid && entry.bestImageUrl,
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
  const roundEndReached =
    isRoundLive && round?.endsAt ? millisecondsLeft(round.endsAt) <= 0 : false;
  const autoEndingSoon =
    isRoundLive &&
    ((!isChangeMode && everyoneScored) || postDeadlineGraceActive);
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
  const changeTimeline = resolveChangeTimeline(
    round?.promptStartsAt,
    roundSeconds,
    changeTimelineNowMs,
  );
  const changeBaseOpacity =
    isChangeMode && isRoundLive ? 1 - changeTimeline.changeProgress : 1;
  const changeProgressFillClass =
    changeTimeline.phase === "waiting"
      ? "bg-[var(--pmb-blue)]"
      : changeTimeline.phase === "changing"
        ? "bg-[var(--pmb-red)]"
        : "bg-[var(--pmb-green)]";
  const impostorReferenceImageUrl =
    impostorModeState?.chainImageUrl || round?.targetImageUrl || "";

  useEffect(() => {
    if (!room || !round) return;
    if (room.status !== "IN_ROUND" || round.status !== "IN_ROUND") return;
    if (isCpuTurn || !round.endsAt) return;
    if ((!postDeadlineGraceActive && !roundEndReached) || endCalled.current) {
      return;
    }

    endCalled.current = true;
    let timeoutDraftPrompt =
      !submitPending && prompt.trim().length > 0 ? prompt : undefined;
    const retrier = createEndRoundRetrier({
      runEndIfNeeded: () =>
        apiPost<EndRoundResponse>("/api/rounds/endIfNeeded", {
          roomId,
          roundId: round.roundId,
          ...(timeoutDraftPrompt ? { draftPrompt: timeoutDraftPrompt } : {}),
        }).then((result) => {
          if (result.consumedDraft) {
            timeoutDraftPrompt = undefined;
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
    postDeadlineGraceActive,
    roundEndReached,
    room?.status,
    round?.status,
    round?.endsAt,
    round?.roundId,
    roomId,
    prompt,
    submitPending,
  ]);

  useEffect(() => {
    if (!autoEndingSoon) {
      resultCountdownFallbackTargetRef.current = null;
      setResultCountdownSeconds(null);
      return;
    }

    const parsedEndsAt = parseDate(round?.endsAt);
    const now = Date.now();
    const countdownTargetMs =
      parsedEndsAt && parsedEndsAt.getTime() > now
        ? parsedEndsAt.getTime()
        : (() => {
            if (resultCountdownFallbackTargetRef.current == null) {
              resultCountdownFallbackTargetRef.current =
                now + RESULTS_GRACE_SECONDS * 1000;
            }
            return resultCountdownFallbackTargetRef.current;
          })();

    const update = () => {
      const leftSeconds = Math.max(
        0,
        Math.ceil((countdownTargetMs - Date.now()) / 1000),
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
    if (isChangeMode || !everyoneScored) return;

    const timeoutId = setTimeout(() => {
      void apiPost("/api/rounds/endIfNeeded", {
        roomId,
        roundId: round.roundId,
      }).catch((err) => {
        console.error("auto endIfNeeded failed", err);
      });
    }, 10_500);

    return () => clearTimeout(timeoutId);
  }, [everyoneScored, isChangeMode, room, round, roomId]);

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

  const submitChangeClick = async (x: number, y: number) => {
    if (!round || !isChangeMode || !isRoundLive || mySubmission) return;

    setSubmitPending(true);
    setFeedback(null);

    try {
      await apiPost<ClickResponse>("/api/rounds/click", {
        roomId,
        roundId: round.roundId,
        x,
        y,
      });
      setFeedback(null);
    } catch (error) {
      setFeedback(toUiError(error, "submitPromptFailed"));
    } finally {
      setSubmitPending(false);
    }
  };

  const onBackToLobby = async () => {
    if (round && isChangeMode && isRoundLive) {
      setManualResultsPending(true);

      try {
        const result = await apiPost<EndRoundResponse>(
          "/api/rounds/endIfNeeded",
          {
            roomId,
            roundId: round.roundId,
            forceResults: true,
          },
        );

        if (result.status === "RESULTS") {
          router.push(buildCurrentAppPath(`/results/${roomId}`));
          return;
        }
      } catch (error) {
        console.error("force change results failed", error);
      } finally {
        setManualResultsPending(false);
      }
    }

    router.push(buildCurrentAppPath(`/results/${roomId}?from=round`));
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">{copy.round.loading}</Card>
      </main>
    );
  }

  if (isChangeMode && changeModeState) {
    const changeMarkerPoint = mySubmission?.point ?? localSelectedPoint;
    const changeMarkerFrameSize =
      changeStageSize ?? changeClickFrameSize ?? null;
    const changeMarkerProjectedPoint =
      changeMarkerPoint && changeMarkerFrameSize
        ? projectImagePointToContainedFrame({
            frame: changeMarkerFrameSize,
            imageAspectRatio: changeStageAspectRatio,
            point: changeMarkerPoint,
          })
        : null;
    const changeMarkerClass = mySubmission
      ? mySubmission.hit
        ? "border-[var(--pmb-green)] bg-[var(--pmb-green)]"
        : "border-[var(--pmb-red)] bg-[var(--pmb-red)]"
      : "border-[var(--pmb-yellow)] bg-[var(--pmb-yellow)]";

    return (
      <main className="page-enter mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-7xl flex-col gap-3 overflow-hidden px-4 py-3 md:px-6">
        <Card className="bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl leading-none font-black uppercase md:text-3xl">
                  Round {round.index}
                </p>
                <Badge className="bg-[var(--pmb-yellow)] text-[var(--pmb-ink)]">
                  {currentMode.label}
                </Badge>
              </div>
              <p className="mt-2 text-sm font-semibold">
                {copy.round.changeInstructions}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CountdownTimer secondsLeft={visibleSecondsLeft} />
              <Card className="bg-[var(--pmb-base)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                <p className="text-xs font-black tracking-[0.18em] uppercase">
                  {copy.round.changeProgressLabel}
                </p>
                <p className="mt-1 font-mono text-lg font-black">
                  {copy.round.changeSubmittedCount(
                    changeSubmittedCount,
                    humanPlayerCount,
                  )}
                </p>
                <p className="text-xs font-semibold">
                  {copy.round.changeCorrectCount(changeCorrectCount)}
                </p>
              </Card>
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
          {feedback ? (
            <p className="mt-3 text-sm font-semibold text-[var(--pmb-red)]">
              {resolveUiErrorMessage(language, feedback)}
            </p>
          ) : mySubmission ? (
            <p className="mt-3 text-sm font-semibold">
              {mySubmission.hit ? copy.round.changeHit : copy.round.changeMiss}
            </p>
          ) : (
            <p className="mt-3 text-sm font-semibold">
              {submitPending
                ? copy.round.changeSubmitted
                : copy.round.changeSelectionHint}
            </p>
          )}
        </Card>

        <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.35fr_0.65fr]">
          <Card className="flex min-h-0 flex-col overflow-hidden bg-white p-3">
            <h3 className="text-base">{copy.round.changeClickToGuess}</h3>

            <div
              ref={changeStageContainerRef}
              className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)]"
            >
              <button
                type="button"
                disabled={
                  !isRoundLive || submitPending || Boolean(mySubmission)
                }
                onClick={(event) => {
                  if (!isRoundLive || submitPending || mySubmission) return;

                  const rect =
                    changeStageRef.current?.getBoundingClientRect() ??
                    event.currentTarget.getBoundingClientRect();
                  const localX = event.clientX - rect.left;
                  const localY = event.clientY - rect.top;

                  if (
                    localX < 0 ||
                    localY < 0 ||
                    localX > rect.width ||
                    localY > rect.height
                  ) {
                    return;
                  }

                  const frame = {
                    width: rect.width,
                    height: rect.height,
                  };
                  const point = mapContainedFramePointToImagePoint({
                    frame,
                    imageAspectRatio: changeStageAspectRatio,
                    localX,
                    localY,
                  });

                  if (!point) {
                    return;
                  }

                  setChangeClickFrameSize(frame);
                  setLocalSelectedPoint(point);
                  void submitChangeClick(point.x, point.y);
                }}
                className={[
                  "flex h-full w-full items-center justify-center overflow-hidden bg-white text-left",
                  mySubmission ? "cursor-default" : "cursor-crosshair",
                  "disabled:cursor-not-allowed disabled:opacity-100",
                ].join(" ")}
              >
                <div
                  ref={changeStageRef}
                  className="relative w-full max-w-full overflow-hidden rounded-md bg-white shadow-[0_0_0_2px_var(--pmb-ink)]"
                  style={
                    changeStageSize
                      ? {
                          width: `${changeStageSize.width}px`,
                          height: `${changeStageSize.height}px`,
                        }
                      : {
                          aspectRatio: `${changeStageAspectRatio}`,
                        }
                  }
                >
                  <img
                    src={
                      changeModeState.changedImageUrl ||
                      placeholderImageUrl(`${round.gmTitle}-changed`)
                    }
                    alt={copy.round.changeAfterLabel}
                    className="absolute inset-0 h-full w-full object-contain"
                    onLoad={(event) =>
                      updateChangeImageAspectRatio(event.currentTarget)
                    }
                    onError={(event) =>
                      applyImageFallback(
                        event.currentTarget,
                        `${round.gmTitle}-changed`,
                      )
                    }
                  />
                  <img
                    src={
                      round.targetImageUrl ||
                      placeholderImageUrl(round.gmTitle || "target")
                    }
                    alt={copy.round.changeBeforeLabel}
                    className="absolute inset-0 h-full w-full object-contain"
                    style={{ opacity: changeBaseOpacity }}
                    onLoad={(event) =>
                      updateChangeImageAspectRatio(event.currentTarget)
                    }
                    onError={(event) =>
                      applyImageFallback(
                        event.currentTarget,
                        round.gmTitle || "target",
                      )
                    }
                  />
                  {changeMarkerPoint ? (
                    <span
                      data-testid="change-click-marker"
                      className={[
                        "absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 shadow-[0_0_0_2px_white]",
                        changeMarkerClass,
                      ].join(" ")}
                      style={{
                        left: `${
                          changeMarkerProjectedPoint?.left ??
                          changeMarkerPoint.x * 100
                        }%`,
                        top: `${
                          changeMarkerProjectedPoint?.top ??
                          changeMarkerPoint.y * 100
                        }%`,
                      }}
                    />
                  ) : null}
                  {changeTimeline.isResetting ? (
                    <span
                      aria-hidden="true"
                      data-testid="change-reset-canvas"
                      className="absolute inset-0 z-20 bg-white"
                    />
                  ) : null}
                </div>
              </button>
            </div>

            <div
              className="mt-3 shrink-0 rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-2"
              data-testid="change-progress"
            >
              <div className="flex items-center justify-end">
                <p className="font-mono text-[10px] font-black">
                  {copy.round.changeViewProgress(
                    changeTimeline.currentView,
                    changeTimeline.viewCount,
                  )}{" "}
                  / {Math.round(changeTimeline.viewProgress * 100)}%
                </p>
              </div>
              <div className="relative mt-2 h-3 rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)]">
                <span
                  className={[
                    "absolute inset-y-0 left-0 w-full origin-left rounded-full transition-colors duration-200",
                    changeProgressFillClass,
                  ].join(" ")}
                  data-testid="change-progress-fill"
                  style={{
                    transform: `scaleX(${changeTimeline.viewProgress})`,
                  }}
                />
                {changeTimeline.markerPercents.flatMap((marker) => [
                  <span
                    key={`${marker.view}-start`}
                    aria-label={copy.round.changeStartMarker}
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[0_0_0_2px_white]"
                    style={{ left: `${marker.changeStart}%` }}
                  />,
                  <span
                    key={`${marker.view}-end`}
                    aria-label={copy.round.changeEndMarker}
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--pmb-ink)] bg-white shadow-[0_0_0_2px_var(--pmb-green)]"
                    style={{ left: `${marker.changeEnd}%` }}
                  />,
                ])}
              </div>
              <div className="mt-1 grid grid-cols-[minmax(0,5fr)_minmax(0,20fr)_minmax(0,5fr)] gap-1 text-[9px] leading-tight font-black uppercase sm:text-[10px]">
                <span
                  className={[
                    "text-left",
                    changeTimeline.phase === "waiting"
                      ? "text-[var(--pmb-blue)]"
                      : "",
                  ].join(" ")}
                >
                  {copy.round.changePhaseWaiting} {CHANGE_WAIT_SECONDS}s
                </span>
                <span
                  className={[
                    "text-center",
                    changeTimeline.phase === "changing"
                      ? "text-[var(--pmb-red)]"
                      : "",
                  ].join(" ")}
                >
                  {copy.round.changePhaseChanging} {CHANGE_TRANSITION_SECONDS}s
                </span>
                <span
                  className={[
                    "text-right",
                    changeTimeline.phase === "answer"
                      ? "text-[var(--pmb-green)]"
                      : "",
                  ].join(" ")}
                >
                  {copy.round.changePhaseAnswer} {CHANGE_ANSWER_SECONDS}s
                </span>
              </div>
            </div>
          </Card>

          <div className="flex min-h-0 flex-col gap-3">
            <Scoreboard entries={scores} myUid={user?.uid} />

            <Card className="bg-white p-3">
              <h3 className="text-base">{copy.results.yourClick}</h3>
              <div className="mt-3 space-y-2 text-sm font-semibold">
                <p>
                  {mySubmission
                    ? `${mySubmission.hit ? copy.common.hit : copy.common.miss} / ${copy.common.points(mySubmission.score)}`
                    : copy.common.notSubmitted}
                </p>
                {mySubmission?.rank ? (
                  <p>{copy.results.rankLabel(mySubmission.rank)}</p>
                ) : null}
                <p>
                  {mySubmission
                    ? copy.round.changeAlreadyLocked
                    : copy.round.changeWaitingForOthers}
                </p>
              </div>
            </Card>
          </div>
        </section>
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
              ? effectiveGeneratedImagePhase === "SCORING"
                ? copy.round.scoring
                : copy.round.generatingImage
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
          {latestAttempt || submitPending ? (
            <div className="space-y-2">
              {showGeneratedImagePreview ? (
                <div className={imageFrameClass}>
                  <img
                    src={latestAttemptImageUrl}
                    alt="latest attempt"
                    className="h-full w-full object-contain p-1"
                    onError={(event) =>
                      applyImageFallback(
                        event.currentTarget,
                        copy.round.generatedImage,
                      )
                    }
                  />
                  {effectiveGeneratedImagePhase === "SCORING" ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                      <p className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold">
                        <LoaderCircle className="h-4 w-4 animate-spin" />{" "}
                        {copy.round.scoring}
                      </p>
                    </div>
                  ) : null}
                  {effectiveGeneratedImagePhase === "DONE" &&
                  typeof latestAttempt?.score === "number" ? (
                    <p className="absolute top-2 right-2 rounded-md border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-1 font-mono text-sm font-black">
                      {latestAttempt.score} pts
                    </p>
                  ) : null}
                </div>
              ) : (
                <div
                  className={`${imageFrameClass} flex flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,var(--pmb-base),white)] p-6 text-center`}
                >
                  <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-blue)] p-4">
                    <LoaderCircle className="h-8 w-8 animate-spin" />
                  </div>
                  <p className="text-lg font-black">
                    {generatedImageStatusLabel}
                  </p>
                </div>
              )}
              <Card className="h-28 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold">
                <p>{copy.common.judgeNote}</p>
                {effectiveGeneratedImagePhase === "DONE" &&
                latestAttempt?.matchedElements?.length ? (
                  <p className="mt-1 text-[var(--pmb-green)]">
                    {copy.common.matched(
                      latestAttempt.matchedElements.join(" / "),
                    )}
                  </p>
                ) : null}
                {effectiveGeneratedImagePhase === "DONE" &&
                latestAttempt?.missingElements?.length ? (
                  <p className="mt-1 text-[var(--pmb-red)]">
                    {copy.common.missing(
                      latestAttempt.missingElements.join(" / "),
                    )}
                  </p>
                ) : null}
                {effectiveGeneratedImagePhase === "SCORING" ? (
                  <p className="mt-1">{copy.round.judgeNotesAfterScoring}</p>
                ) : null}
                {effectiveGeneratedImagePhase === "GENERATING" ? (
                  <p className="mt-1">{copy.round.generatingImage}</p>
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
