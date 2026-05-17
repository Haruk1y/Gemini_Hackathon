"use client";
/* eslint-disable @next/next/no-img-element */

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { EyeOff, LoaderCircle, Lock, Send } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { CountdownTimer } from "@/components/game/countdown-timer";
import { Scoreboard } from "@/components/game/scoreboard";
import { StampDock } from "@/components/game/stamp-dock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiPost } from "@/lib/client/api";
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
} from "@/lib/game/modes";
import { formatSeconds, millisecondsLeft, parseDate } from "@/lib/utils/time";

type SubmitResponse = Record<string, unknown> & {
  ok: true;
  score: number | null;
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

function isScorePollingContention(error: unknown) {
  return error instanceof ApiClientError && error.code === "RATE_LIMIT";
}

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
  const [localSelectedPoint, setLocalSelectedPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [changeClickFrameSize, setChangeClickFrameSize] =
    useState<FrameSize | null>(null);

  const endCalled = useRef(false);
  const changeStageContainerRef = useRef<HTMLDivElement | null>(null);
  const changeStageRef = useRef<HTMLDivElement | null>(null);
  const cpuTurnFiredRef = useRef<string | null>(null);
  const draftSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastDraftSyncedRef = useRef<string | null>(null);
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
  const recentStamps = snapshot.recentStamps ?? [];
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
  const myTurnRecord = snapshot.myTurnRecord ?? null;
  const isImpostorScoringPhase = Boolean(
    isImpostorMode &&
    room?.status === "IN_ROUND" &&
    impostorModeState?.phase === "SCORING",
  );
  const roundSeconds = room?.settings?.roundSeconds ?? 60;
  const roomStatus = room?.status ?? null;
  const roundStatus = round?.status ?? null;
  const activeRoundId = round?.roundId ?? null;
  const roundEndsAt = round?.endsAt ?? null;
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
      (isCpuTurn || impostorModeState?.phase === "SCORING")
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
  }, [
    currentGameMode,
    impostorModeState?.phase,
    isCpuTurn,
    isImpostorMode,
    round,
    room,
    roundSeconds,
  ]);

  useEffect(() => {
    endCalled.current = false;
    endRoundRetrier.current?.cancel();
    endRoundRetrier.current = null;
    lastDraftSyncedRef.current = null;
    setLocalSelectedPoint(null);
    setChangeClickFrameSize(null);
  }, [currentTurnUid, round?.endsAt, round?.roundId, room?.status]);

  useEffect(() => {
    setChangeImageAspectRatio(null);
  }, [changeModeState?.changedImageUrl, round?.roundId, round?.targetImageUrl]);

  useEffect(() => {
    if (draftSyncTimeoutRef.current) {
      clearTimeout(draftSyncTimeoutRef.current);
      draftSyncTimeoutRef.current = null;
    }

    if (
      !isImpostorMode ||
      !isMyTurn ||
      !room ||
      !round ||
      room.status !== "IN_ROUND" ||
      round.status !== "IN_ROUND" ||
      isCpuTurn ||
      impostorModeState?.phase !== "CHAIN"
    ) {
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === (lastDraftSyncedRef.current ?? "")) {
      return;
    }

    draftSyncTimeoutRef.current = setTimeout(() => {
      draftSyncTimeoutRef.current = null;
      void apiPost("/api/rounds/save-draft", {
        roomId,
        roundId: round.roundId,
        prompt,
      })
        .then(() => {
          lastDraftSyncedRef.current = trimmedPrompt;
        })
        .catch((error) => {
          console.warn("save draft failed", error);
        });
    }, 250);

    return () => {
      if (draftSyncTimeoutRef.current) {
        clearTimeout(draftSyncTimeoutRef.current);
        draftSyncTimeoutRef.current = null;
      }
    };
  }, [
    impostorModeState?.phase,
    isCpuTurn,
    isImpostorMode,
    isMyTurn,
    prompt,
    room,
    roomId,
    round,
  ]);

  useEffect(() => {
    const roundIdValue = round?.roundId;
    const fireKey = `${roundIdValue}:${currentTurnUid}`;

    if (
      !isCpuTurn ||
      !roundIdValue ||
      impostorModeState?.phase !== "CHAIN" ||
      room?.status !== "IN_ROUND"
    ) {
      return;
    }

    if (cpuTurnFiredRef.current === fireKey) return;
    cpuTurnFiredRef.current = fireKey;

    void apiPost("/api/rounds/cpu-turn", {
      roomId,
      roundId: roundIdValue,
    }).catch((error) => {
      console.warn("CPU turn trigger failed", error);
      cpuTurnFiredRef.current = null;
    });
  }, [
    currentTurnUid,
    impostorModeState?.phase,
    isCpuTurn,
    room?.status,
    roomId,
    round?.roundId,
  ]);

  useEffect(() => {
    if (!isImpostorScoringPhase || !round) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const trigger = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await apiPost("/api/rounds/score-pending", {
          roomId,
          roundId: round.roundId,
        });
      } catch (error) {
        if (!cancelled && !isScorePollingContention(error)) {
          console.error("round scoring pending failed", error);
        }
      } finally {
        inFlight = false;
      }
    };

    void trigger();
    const intervalId = window.setInterval(() => {
      void trigger();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isImpostorScoringPhase, roomId, round]);

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
    if (!roomStatus || !roundStatus) return;

    if (roomStatus === "RESULTS") {
      router.replace(buildCurrentAppPath(`/results/${roomId}`));
      return;
    }

    if (roomStatus === "LOBBY") {
      router.replace(buildCurrentAppPath(`/lobby/${roomId}`));
      return;
    }

    if (roomStatus === "FINISHED") {
      router.replace(buildCurrentAppPath("/"));
      return;
    }
  }, [roomStatus, roundStatus, roomId, router]);

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
  const latestAttemptReviewVisible = Boolean(
    effectiveGeneratedImagePhase === "DONE" &&
    ((latestAttempt?.matchedElements?.length ?? 0) > 0 ||
      (latestAttempt?.missingElements?.length ?? 0) > 0),
  );
  const attemptsLeft = Math.max(
    0,
    (room?.settings?.maxAttempts ?? 0) - (attempts?.attemptsUsed ?? 0),
  );
  const isRoundLive =
    room?.status === "IN_ROUND" && round?.status === "IN_ROUND";
  const isBusy = submitPending || isImpostorScoringPhase;

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

  const hasGeneratedImage = Boolean(
    attempts?.attempts?.some((attempt) => attempt.imageUrl.trim().length > 0),
  );
  const everyoneScored = playerCount > 0 && scores.length >= playerCount;
  const shouldAutoEndAfterScores =
    !isChangeMode && everyoneScored && (room?.settings?.maxAttempts ?? 1) <= 1;
  const shouldAutoEndAfterChangeSubmissions =
    isChangeMode &&
    humanPlayerCount > 0 &&
    changeSubmittedCount >= humanPlayerCount;
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
    (shouldAutoEndAfterScores ||
      shouldAutoEndAfterChangeSubmissions ||
      roundEndReached);
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
  const roundImageFrameClass =
    "relative mx-auto aspect-square w-full max-w-60 overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-white xl:max-w-72 2xl:max-w-80";
  const judgeNotesClass =
    "h-20 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold";
  const promptPanelHeightClass =
    "lg:h-[220px] lg:min-h-[220px] lg:max-h-[220px]";
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
  const impostorPreviousImageUrl =
    snapshot.myReferenceImageUrl || (isMyTurn ? impostorReferenceImageUrl : "");
  const myTurnRecordScoring = Boolean(
    myTurnRecord &&
    myTurnRecord.imageUrl.trim().length > 0 &&
    myTurnRecord.similarityScore == null,
  );

  useEffect(() => {
    if (!activeRoundId) return;
    if (roomStatus !== "IN_ROUND" || roundStatus !== "IN_ROUND") return;
    if (isImpostorScoringPhase) return;
    if (isCpuTurn || !roundEndsAt) return;
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
          roundId: activeRoundId,
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
    isImpostorScoringPhase,
    postDeadlineGraceActive,
    roundEndReached,
    roomStatus,
    roundStatus,
    roundEndsAt,
    activeRoundId,
    roomId,
    prompt,
    submitPending,
  ]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user),
  });

  const submitPrompt = async () => {
    if (!round || !prompt.trim() || promptLocked || isImpostorScoringPhase) {
      return;
    }

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

  const submitPromptOnShortcut = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      event.key !== "Enter" ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submitPrompt();
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

  if (!room || !round) {
    return (
      <main className="mx-auto flex h-[100dvh] items-center justify-center overflow-y-auto p-6">
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
      <main className="page-enter mx-auto flex h-[100dvh] w-full flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-3 md:px-6">
        <StampDock
          roomId={roomId}
          recentStamps={recentStamps}
          disabled={!isRoundLive}
        />
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
    const primaryImageUrl = impostorPreviousImageUrl;
    const primaryImageHeading = primaryImageUrl
      ? copy.round.referenceImage
      : copy.round.hidden;
    const primaryImageDescription = primaryImageUrl
      ? copy.round.referenceDescription
      : isCpuTurn
        ? copy.round.cpuPassMessage
        : copy.round.hiddenImageDescription;

    return (
      <main className="page-enter mx-auto flex h-[100dvh] w-full flex-col gap-3 overflow-y-auto px-4 py-3 md:px-6">
        <StampDock
          roomId={roomId}
          recentStamps={recentStamps}
          disabled={!isRoundLive || isCpuTurn || isImpostorScoringPhase}
        />
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
              {isImpostorScoringPhase ? (
                <Card className="bg-[var(--pmb-yellow)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                  <p className="text-xs font-black tracking-[0.18em] uppercase">
                    {copy.round.scoring}
                  </p>
                </Card>
              ) : isCpuTurn ? (
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
            onKeyDown={submitPromptOnShortcut}
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
                : isImpostorScoringPhase
                  ? copy.results.waitingScoring
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

        <section className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1fr_0.95fr]">
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

          <Card className="bg-white p-3">
            <h3 className="mb-2 text-base">{copy.round.generatedImage}</h3>
            {myTurnRecord ? (
              <div className="space-y-2">
                <div className={imageFrameClass}>
                  {myTurnRecord.imageUrl ? (
                    <img
                      src={myTurnRecord.imageUrl}
                      alt={copy.round.generatedImage}
                      className="h-full w-full object-contain p-1"
                      onError={(event) =>
                        applyImageFallback(
                          event.currentTarget,
                          copy.round.generatedImage,
                        )
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[var(--pmb-base)] p-4 text-center text-sm font-semibold">
                      {copy.round.noImageYet}
                    </div>
                  )}
                  {myTurnRecordScoring ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                      <p className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        {copy.round.scoring}
                      </p>
                    </div>
                  ) : null}
                  {!myTurnRecordScoring &&
                  typeof myTurnRecord.similarityScore === "number" ? (
                    <p className="absolute top-2 right-2 rounded-md border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-1 text-right font-mono text-sm font-black">
                      {myTurnRecord.similarityScore} pts
                    </p>
                  ) : null}
                </div>
                <Card className="h-28 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold">
                  <p>{copy.common.judgeNote}</p>
                  {!myTurnRecordScoring &&
                  myTurnRecord.matchedElements?.length ? (
                    <p className="mt-1 text-[var(--pmb-green)]">
                      {copy.common.matched(
                        myTurnRecord.matchedElements.join(" / "),
                      )}
                    </p>
                  ) : null}
                  {!myTurnRecordScoring &&
                  myTurnRecord.missingElements?.length ? (
                    <p className="mt-1 text-[var(--pmb-red)]">
                      {copy.common.missing(
                        myTurnRecord.missingElements.join(" / "),
                      )}
                    </p>
                  ) : null}
                  {!myTurnRecordScoring && myTurnRecord.judgeNote ? (
                    <p className="mt-1">{myTurnRecord.judgeNote}</p>
                  ) : null}
                  {myTurnRecordScoring ? (
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
                </Card>
              </div>
            )}
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
    <main className="page-enter mx-auto flex h-[100dvh] w-full flex-col gap-3 overflow-y-auto px-4 py-3 md:px-6">
      <StampDock
        roomId={roomId}
        recentStamps={recentStamps}
        disabled={!isRoundLive}
      />
      <section className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.95fr)]">
        <div className="grid gap-3 lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,1fr)_auto]">
          <Card className="bg-white p-4 lg:col-span-2">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
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

              <div className="justify-self-start md:justify-self-end">
                {isPreviewPhase ? (
                  <Card className="bg-[var(--pmb-blue)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                    <p className="text-xs font-black tracking-[0.18em] uppercase">
                      {copy.round.memoryPreview}
                    </p>
                    <p className="mt-1 font-mono text-2xl font-black">
                      {formatSeconds(
                        previewSecondsLeft ?? MEMORY_PREVIEW_SECONDS,
                      )}
                    </p>
                  </Card>
                ) : (
                  <CountdownTimer secondsLeft={visibleSecondsLeft} />
                )}
              </div>
            </div>
          </Card>

          <Card className="bg-white p-3">
            <h3 className="mb-2 text-base">{copy.round.targetImage}</h3>
            {shouldShowTargetImage ? (
              round.targetImageUrl ? (
                <div className={roundImageFrameClass}>
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
                  className={`${roundImageFrameClass} flex items-center justify-center border-dashed bg-[var(--pmb-base)] p-4 text-center text-sm font-semibold`}
                >
                  {copy.round.syncingTargetImage}
                </div>
              )
            ) : (
              <div
                className={`${roundImageFrameClass} flex flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,var(--pmb-base),white)] p-6 text-center`}
              >
                <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4">
                  <EyeOff className="h-8 w-8" />
                </div>
                <p className="text-lg font-black">{copy.round.memoryOnly}</p>
              </div>
            )}
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden bg-white p-3">
            <h3 className="mb-2 text-base">{copy.round.generatedImage}</h3>
            {latestAttempt || submitPending ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                {showGeneratedImagePreview ? (
                  <div className={roundImageFrameClass}>
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
                  </div>
                ) : (
                  <div
                    className={`${roundImageFrameClass} flex flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,var(--pmb-base),white)] p-6 text-center`}
                  >
                    <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-blue)] p-4">
                      <LoaderCircle className="h-8 w-8 animate-spin" />
                    </div>
                    <p className="text-lg font-black">
                      {generatedImageStatusLabel}
                    </p>
                  </div>
                )}
                {latestAttemptReviewVisible ? (
                  <Card className={judgeNotesClass}>
                    {latestAttempt?.matchedElements?.length ? (
                      <p className="text-[var(--pmb-green)]">
                        {copy.common.matched(
                          latestAttempt.matchedElements.join(" / "),
                        )}
                      </p>
                    ) : null}
                    {latestAttempt?.missingElements?.length ? (
                      <p className="text-[var(--pmb-red)]">
                        {copy.common.missing(
                          latestAttempt.missingElements.join(" / "),
                        )}
                      </p>
                    ) : null}
                  </Card>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div
                  className={`${roundImageFrameClass} flex items-center justify-center border-dashed bg-[var(--pmb-base)] p-4 text-sm font-semibold`}
                >
                  {copy.round.noImageYet}
                </div>
              </div>
            )}
          </Card>

          <Card
            className={`bg-white p-4 lg:col-span-2 lg:overflow-y-auto ${promptPanelHeightClass}`}
          >
            <h2 className="mb-2 text-lg">{copy.round.memoryPromptTitle}</h2>
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={submitPromptOnShortcut}
                placeholder={
                  isPreviewPhase
                    ? copy.round.memoryLockedPlaceholder
                    : copy.round.promptExample
                }
                maxLength={600}
                className={`min-h-24 ${
                  isPreviewPhase
                    ? "resize-none border-[var(--pmb-ink)] bg-[var(--pmb-base)] text-transparent placeholder:text-transparent"
                    : ""
                }`}
                disabled={
                  promptLocked || !isRoundLive || attemptsLeft <= 0 || isBusy
                }
                aria-describedby={
                  isPreviewPhase ? "memory-prompt-lock" : undefined
                }
              />
              {isPreviewPhase ? (
                <div
                  id="memory-prompt-lock"
                  data-testid="memory-prompt-lock"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white/95 p-3 text-center"
                  role="status"
                >
                  <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-red)] p-3 text-white">
                    <Lock
                      className="h-8 w-8 sm:h-10 sm:w-10"
                      strokeWidth={3.5}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl leading-none font-black tracking-[0.08em] uppercase sm:text-3xl">
                      {copy.round.memoryLockedOverlayTitle}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
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
        </div>

        <aside className="flex min-h-0 flex-col gap-3 lg:h-full">
          <Scoreboard
            className="lg:flex-1 lg:overflow-hidden"
            entries={scores}
            myUid={user?.uid}
            showImages
          />
        </aside>
      </section>
    </main>
  );
}
