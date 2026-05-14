"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bot,
  Brain,
  Check,
  Clock3,
  Copy,
  Eye,
  Gamepad2,
  Ghost,
  ListChecks,
  LoaderCircle,
  LogOut,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  type LucideIcon,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { apiPost } from "@/lib/client/api";
import { buildCurrentAppPath } from "@/lib/client/paths";
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
import {
  resolveUiErrorMessage,
  toUiError,
  type UiError,
} from "@/lib/i18n/errors";
import { useRoomSync } from "@/lib/client/room-sync";
import {
  CHANGE_DEFAULT_ROUND_SECONDS,
  CHANGE_ROUND_SECONDS_OPTIONS,
  getGameModeDefinition,
  getGameModeOptions,
  getChangeViewCountForRoundSeconds,
  normalizeRoundSecondsForMode,
  STANDARD_DEFAULT_ROUND_SECONDS,
  STANDARD_ROUND_SECONDS_OPTIONS,
} from "@/lib/game/modes";
import { getMaxCpuPlayersForMode } from "@/lib/game/cpu";
import type { GameMode } from "@/lib/types/game";

type ActionBusy = "ready" | "start" | "leave" | "shuffle" | null;
type SettingsStatus = "idle" | "saving" | "saved" | "error";

interface PickerOption {
  value: number;
  label: string;
  unitLabel: string;
}

interface SwipeValuePickerProps {
  label: string;
  icon: LucideIcon;
  options: readonly PickerOption[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

const MODE_PREVIEW_IMAGES: Record<GameMode, string> = {
  classic: "/remotion/prompdojo-intro/modes/classic-wide.png",
  memory: "/remotion/prompdojo-intro/modes/memory-wide.png",
  change: "/remotion/prompdojo-intro/modes/aha-moment-wide.png",
  impostor: "/remotion/prompdojo-intro/modes/art-imposter-wide.png",
};

const ROUND_OPTIONS: readonly PickerOption[] = [
  { value: 1, label: "1", unitLabel: "ROUND" },
  { value: 2, label: "2", unitLabel: "ROUNDS" },
  { value: 3, label: "3", unitLabel: "ROUNDS" },
  { value: 4, label: "4", unitLabel: "ROUNDS" },
  { value: 5, label: "5", unitLabel: "ROUNDS" },
];

const STANDARD_ROUND_TIME_OPTIONS: readonly PickerOption[] =
  STANDARD_ROUND_SECONDS_OPTIONS.map((value) => ({
    value,
    label: String(value),
    unitLabel: "SEC",
  }));

const CHANGE_ROUND_TIME_OPTIONS: readonly PickerOption[] =
  CHANGE_ROUND_SECONDS_OPTIONS.map((value) => {
    const repeatCount = getChangeViewCountForRoundSeconds(value);
    return {
      value,
      label: String(repeatCount),
      unitLabel: repeatCount === 1 ? "VIEW" : "VIEWS",
    };
  });

function formatSettingsKey(
  gameMode: GameMode,
  totalRounds: number,
  roundSeconds: number,
  cpuCount: number,
) {
  return `${gameMode}:${totalRounds}:${roundSeconds}:${cpuCount}`;
}

function SwipeValuePicker({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  disabled = false,
}: SwipeValuePickerProps) {
  const { copy } = useLanguage();
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[currentIndex] ?? options[0];
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex < options.length - 1;

  const shiftIndex = (delta: number) => {
    if (disabled || delta === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(options.length - 1, currentIndex + delta),
    );
    if (nextIndex === currentIndex) return;
    onChange(options[nextIndex]!.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      shiftIndex(-1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      shiftIndex(1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(options[0]!.value);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(options[options.length - 1]!.value);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(108px,0.2fr)_40px_minmax(0,1fr)_40px] items-center gap-2 py-1 sm:grid-cols-[minmax(120px,0.18fr)_42px_minmax(0,1fr)_42px]">
      <p className="flex min-w-0 items-center gap-2 text-[15px] leading-none font-black tracking-[0.08em] uppercase md:text-base">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[2px_2px_0_var(--pmb-ink)]">
          <Icon className="h-4 w-4 stroke-[3]" />
        </span>
        <span className="truncate">{label}</span>
      </p>

      <button
        type="button"
        disabled={disabled || !canDecrease}
        onClick={() => shiftIndex(-1)}
        aria-label={`${label} -`}
        className={[
          "grid h-9 w-9 place-items-center rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white transition-transform duration-150 sm:h-10 sm:w-10",
          "shadow-[3px_3px_0_var(--pmb-ink)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[2px_2px_0_var(--pmb-ink)]",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
      >
        <Minus className="h-5 w-5 stroke-[3]" />
      </button>

      <button
        type="button"
        disabled={disabled}
        onKeyDown={onKeyDown}
        className={[
          "relative flex h-10 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-[14px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] text-center transition-transform duration-150 sm:h-11",
          "shadow-[4px_4px_0_var(--pmb-ink)] hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--pmb-ink)]",
          "focus-visible:ring-4 focus-visible:ring-[color:color-mix(in_srgb,var(--pmb-blue)_55%,white)] focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
        aria-label={copy.lobby.changePickerAria(label)}
        aria-valuemin={options[0]!.value}
        aria-valuemax={options[options.length - 1]!.value}
        aria-valuenow={selectedOption.value}
        aria-valuetext={`${selectedOption.label} ${selectedOption.unitLabel}`}
        role="spinbutton"
      >
        <span className="text-[1.55rem] leading-none font-black tracking-[-0.02em] sm:text-[1.8rem]">
          {selectedOption.label}
        </span>
        {selectedOption.unitLabel ? (
          <span className="text-[11px] font-black tracking-[0.2em] uppercase">
            {selectedOption.unitLabel}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        disabled={disabled || !canIncrease}
        onClick={() => shiftIndex(1)}
        aria-label={`${label} +`}
        className={[
          "grid h-9 w-9 place-items-center rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white transition-transform duration-150 sm:h-10 sm:w-10",
          "shadow-[3px_3px_0_var(--pmb-ink)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[2px_2px_0_var(--pmb-ink)]",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
      >
        <Plus className="h-5 w-5 stroke-[3]" />
      </button>
    </div>
  );
}

export default function LobbyPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { language, copy } = useLanguage();
  const { user, loading, error: authError } = useAuth();
  const [isLeaving, setIsLeaving] = useState(false);
  const {
    snapshot,
    error: snapshotError,
    isConnecting,
  } = useRoomSync({
    roomId,
    view: "lobby",
    enabled: Boolean(user) && !loading && !isLeaving,
  });

  const [actionBusy, setActionBusy] = useState<ActionBusy>(null);
  const [actionError, setActionError] = useState<UiError | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>("idle");
  const [settingsError, setSettingsError] = useState<UiError | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">(
    "idle",
  );
  const [draftGameMode, setDraftGameMode] = useState<GameMode>("classic");
  const [draftTotalRounds, setDraftTotalRounds] = useState(1);
  const [draftRoundSeconds, setDraftRoundSeconds] = useState(60);
  const [draftCpuCount, setDraftCpuCount] = useState(0);
  const [draftsReady, setDraftsReady] = useState(false);
  const [optimisticReady, setOptimisticReady] = useState<boolean | null>(null);
  const saveSequenceRef = useRef(0);
  const autoReadyAttemptedRef = useRef(false);

  const room = snapshot.room;
  const players = snapshot.players;
  const displayPlayers = players.map((player) =>
    player.uid === user?.uid && optimisticReady !== null
      ? { ...player, ready: optimisticReady }
      : player,
  );
  const me = displayPlayers.find((player) => player.uid === user?.uid) ?? null;
  const currentGameMode = room?.settings?.gameMode ?? "classic";
  const currentTotalRounds = room?.settings?.totalRounds ?? 1;
  const currentRoundSeconds = room?.settings?.roundSeconds ?? 60;
  const currentCpuCount = room?.settings?.cpuCount ?? 0;
  const displayGameMode =
    me?.isHost && draftsReady ? draftGameMode : currentGameMode;
  const nextRoundPreparation = room?.nextRoundPreparation ?? null;
  const currentMode = getGameModeDefinition(displayGameMode, language);
  const gameModeOptions = getGameModeOptions(language);
  const roundTimeOptions =
    draftGameMode === "change"
      ? CHANGE_ROUND_TIME_OPTIONS
      : STANDARD_ROUND_TIME_OPTIONS;
  const readyCount = displayPlayers.filter((player) => player.ready).length;
  const everyoneReady =
    displayPlayers.length > 0 && readyCount === displayPlayers.length;
  const humanPlayerCount = displayPlayers.filter(
    (player) => player.kind === "human",
  ).length;
  const maxPlayers = room?.settings?.maxPlayers ?? 8;
  const maxCpuCount = Math.max(
    0,
    Math.min(
      getMaxCpuPlayersForMode(draftGameMode),
      maxPlayers - humanPlayerCount,
    ),
  );
  const cpuOptions = Array.from({ length: maxCpuCount + 1 }, (_, index) => ({
    value: index,
    label: String(index),
    unitLabel: "CPU",
  }));
  const roomStatus = room?.status ?? null;
  const isGenerating = roomStatus === "GENERATING_ROUND";
  const hostCanEdit =
    Boolean(me?.isHost) && roomStatus === "LOBBY" && !isGenerating;
  const currentSettingsKey = formatSettingsKey(
    currentGameMode,
    currentTotalRounds,
    currentRoundSeconds,
    currentCpuCount,
  );
  const draftSettingsKey = formatSettingsKey(
    draftGameMode,
    draftTotalRounds,
    draftRoundSeconds,
    draftGameMode === "change" ? 0 : draftCpuCount,
  );
  const settingsDirty = currentSettingsKey !== draftSettingsKey;
  const settingsPending = settingsDirty || settingsStatus === "saving";
  const canStartRound =
    (displayGameMode === "change"
      ? humanPlayerCount >= 1
      : displayPlayers.length >= (displayGameMode === "impostor" ? 2 : 1)) &&
    Boolean(me?.isHost) &&
    everyoneReady &&
    !isGenerating &&
    actionBusy === null &&
    !settingsPending;
  const canShufflePlayers =
    Boolean(me?.isHost) &&
    roomStatus === "LOBBY" &&
    !isGenerating &&
    actionBusy === null &&
    displayPlayers.length >= 2;

  useEffect(() => {
    if (!roomStatus) return;

    if (roomStatus === "IN_ROUND") {
      router.replace(buildCurrentAppPath(`/round/${roomId}`));
      return;
    }

    if (roomStatus === "RESULTS") {
      router.replace(buildCurrentAppPath(`/results/${roomId}`));
      return;
    }

    if (roomStatus === "FINISHED") {
      router.replace(buildCurrentAppPath("/"));
    }
  }, [roomId, roomStatus, router]);

  useEffect(() => {
    if (optimisticReady === null) return;
    const actualReady =
      players.find((player) => player.uid === user?.uid)?.ready ?? null;
    if (actualReady === optimisticReady) {
      setOptimisticReady(null);
    }
  }, [optimisticReady, players, user?.uid]);

  useEffect(() => {
    if (!roomStatus) return;
    if (!draftsReady) {
      setDraftGameMode(currentGameMode);
      setDraftTotalRounds(currentTotalRounds);
      setDraftRoundSeconds(currentRoundSeconds);
      setDraftCpuCount(currentCpuCount);
      setDraftsReady(true);
      return;
    }

    if (me?.isHost && settingsDirty) {
      return;
    }

    setDraftGameMode(currentGameMode);
    setDraftTotalRounds(currentTotalRounds);
    setDraftRoundSeconds(currentRoundSeconds);
    setDraftCpuCount(currentCpuCount);
  }, [
    currentCpuCount,
    currentGameMode,
    currentRoundSeconds,
    currentTotalRounds,
    draftsReady,
    me?.isHost,
    roomStatus,
    settingsDirty,
  ]);

  useEffect(() => {
    if (!draftsReady || !hostCanEdit || !roomStatus || !settingsDirty) return;

    setSettingsStatus("saving");
    setSettingsError(null);
    const sequence = ++saveSequenceRef.current;
    const timerId = window.setTimeout(() => {
      void apiPost("/api/rooms/settings", {
        roomId,
        settings: {
          gameMode: draftGameMode,
          totalRounds: draftTotalRounds,
          roundSeconds: draftRoundSeconds,
          cpuCount: draftGameMode === "change" ? 0 : draftCpuCount,
        },
      })
        .then(() => {
          if (saveSequenceRef.current !== sequence) return;
          setSettingsStatus("saved");
        })
        .catch((error) => {
          if (saveSequenceRef.current !== sequence) return;
          setSettingsStatus("error");
          setSettingsError(toUiError(error, "updateRulesFailed"));
        });
    }, 220);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    draftCpuCount,
    draftGameMode,
    draftRoundSeconds,
    draftTotalRounds,
    draftsReady,
    hostCanEdit,
    roomId,
    roomStatus,
    settingsDirty,
  ]);

  useEffect(() => {
    if (!draftsReady || !hostCanEdit) return;
    if (draftCpuCount <= maxCpuCount) return;
    setDraftCpuCount(maxCpuCount);
  }, [draftCpuCount, draftsReady, hostCanEdit, maxCpuCount]);

  useEffect(() => {
    if (!draftsReady) return;

    const normalized = normalizeRoundSecondsForMode(
      draftGameMode,
      draftRoundSeconds,
    );
    if (normalized !== draftRoundSeconds) {
      setDraftRoundSeconds(normalized);
    }
  }, [draftGameMode, draftRoundSeconds, draftsReady]);

  useEffect(() => {
    if (settingsDirty) return;
    setSettingsError(null);
    if (settingsStatus === "error") {
      setSettingsStatus("idle");
    }
  }, [settingsDirty, settingsStatus]);

  useEffect(() => {
    if (settingsStatus !== "saved") return;
    const timerId = window.setTimeout(() => {
      setSettingsStatus("idle");
    }, 900);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [settingsStatus]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user) && !isLeaving,
  });

  const updateReady = async (
    nextReady: boolean,
    options?: { silent?: boolean },
  ) => {
    setActionBusy("ready");
    if (!options?.silent) {
      setActionError(null);
    }
    setOptimisticReady(nextReady);
    try {
      await apiPost("/api/rooms/ready", {
        roomId,
        ready: nextReady,
      });
    } catch (error) {
      setOptimisticReady(null);
      if (!options?.silent) {
        setActionError(toUiError(error, "readyUpdateFailed"));
      }
    } finally {
      setActionBusy(null);
    }
  };

  useEffect(() => {
    if (roomStatus !== "LOBBY" || !me || isLeaving) return;
    if (me.ready || optimisticReady === true) return;
    if (actionBusy === "ready" || autoReadyAttemptedRef.current) return;

    autoReadyAttemptedRef.current = true;
    void updateReady(true, { silent: true });
  }, [actionBusy, isLeaving, me, optimisticReady, roomStatus]);

  const onStart = async () => {
    if (!me?.isHost || !canStartRound) return;

    setActionBusy("start");
    setActionError(null);
    try {
      await apiPost("/api/rounds/start", {
        roomId,
      });
      router.push(buildCurrentAppPath(`/round/${roomId}`));
    } catch (error) {
      setActionError(toUiError(error, "startRoundFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const onLeave = async () => {
    setIsLeaving(true);
    setActionBusy("leave");
    setActionError(null);
    try {
      await leaveRoom({ roomId });
      router.replace(buildCurrentAppPath("/"));
    } catch (error) {
      setIsLeaving(false);
      setActionError(toUiError(error, "leaveRoomFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const onShufflePlayers = async () => {
    if (!canShufflePlayers) return;

    setActionBusy("shuffle");
    setActionError(null);
    try {
      await apiPost("/api/rooms/shuffle-order", {
        roomId,
      });
    } catch (error) {
      setActionError(toUiError(error, "shufflePlayersFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const copyCode = async () => {
    if (!room?.code) return;

    try {
      await navigator.clipboard.writeText(room.code);
      setCopyStatus("done");
      window.setTimeout(() => setCopyStatus("idle"), 1400);
    } catch {
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  };

  const settingsStatusMessage = (() => {
    if (settingsError) {
      return resolveUiErrorMessage(language, settingsError);
    }

    return null;
  })();

  const lobbyStatusMessage = (() => {
    if (actionError) {
      return resolveUiErrorMessage(language, actionError);
    }

    return null;
  })();
  const preparationMessage = (() => {
    if (nextRoundPreparation?.status === "FAILED") {
      return copy.lobby.nextRoundFallback;
    }

    return null;
  })();

  if (isLeaving || loading || (isConnecting && !snapshotError && !room)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">{copy.lobby.loading}</Card>
      </main>
    );
  }

  if (authError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {resolveUiErrorMessage(language, authError)}
          </p>
        </Card>
      </main>
    );
  }

  if (snapshotError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {copy.lobby.roomInfoFetchFailed(snapshotError.message)}
          </p>
        </Card>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {copy.lobby.roomInfoUnavailable}
          </p>
        </Card>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {copy.lobby.roomSessionMismatch}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-3 md:px-4 md:py-3 lg:h-[100dvh] lg:overflow-hidden">
      <Card className="overflow-hidden bg-white p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 bg-[var(--pmb-yellow)] px-4 py-3 md:px-5">
          <div>
            <p className="text-[11px] font-black tracking-[0.24em] uppercase">
              {copy.lobby.roomCode}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-[1.75rem] font-black tracking-[0.28em] md:text-[2.15rem]">
                {room.code}
              </h1>

              <Button
                onClick={copyCode}
                type="button"
                variant="ghost"
                aria-label={
                  copyStatus === "done"
                    ? copy.lobby.copied
                    : copy.lobby.copyRoomCode
                }
                className={[
                  "h-10 w-10 p-0",
                  "hover:translate-x-0 hover:-translate-y-0 hover:shadow-[6px_6px_0_var(--pmb-ink)]",
                  "active:translate-x-0.5 active:translate-y-0.5 active:shadow-[4px_4px_0_var(--pmb-ink)]",
                  copyStatus === "done"
                    ? "bg-[var(--pmb-green)] text-[var(--pmb-ink)]"
                    : "",
                  copyStatus === "error"
                    ? "bg-[var(--pmb-red)] text-white"
                    : "",
                ].join(" ")}
              >
                {copyStatus === "done" ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Copy className="h-5 w-5" />
                )}
              </Button>
              <LanguageToggle className="shrink-0" />
            </div>
          </div>

          <div className="flex flex-wrap items-stretch justify-end gap-2 self-stretch">
            <div className="flex">
              <Button
                type="button"
                variant="ghost"
                onClick={onLeave}
                disabled={actionBusy !== null}
                className="h-full min-h-[62px] px-5 text-base"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {copy.lobby.leave}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <section className="grid flex-1 gap-2 lg:min-h-0 lg:grid-cols-[minmax(220px,250px)_minmax(0,1fr)] xl:grid-cols-[minmax(230px,260px)_minmax(0,1fr)]">
        <Card className="relative flex flex-col bg-white p-3 md:p-3.5 lg:min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-2xl font-black md:text-[1.7rem]">
              <Users className="h-5 w-5" /> {copy.lobby.players}
            </h2>
          </div>

          <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {displayPlayers.map((player) => {
              const isSelf = player.uid === user?.uid;

              return (
                <div
                  key={player.uid}
                  className={[
                    "flex items-center gap-2 rounded-[14px] border-2 border-[var(--pmb-ink)] px-3 py-2",
                    isSelf ? "bg-[var(--pmb-yellow)]" : "bg-[var(--pmb-base)]",
                  ].join(" ")}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-black md:text-[15px]">
                      {player.displayName}
                    </span>
                    {player.kind === "cpu" ? (
                      <Badge className="bg-white px-2 py-0 text-[10px]">
                        <Bot className="mr-1 h-3 w-3" /> {copy.common.cpu}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative mt-3 border-t-4 border-[var(--pmb-ink)] pt-2">
            {me?.isHost ? (
              <div className="mb-2 sm:absolute sm:right-0 sm:bottom-full sm:mb-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onShufflePlayers}
                  disabled={!canShufflePlayers}
                  className="h-11 min-w-[168px] px-4 text-sm font-black"
                >
                  {actionBusy === "shuffle" ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shuffle className="mr-2 h-4 w-4" />
                  )}
                  {copy.lobby.shufflePlayers}
                </Button>
              </div>
            ) : null}

            {me?.isHost ? (
              <Button
                type="button"
                variant="accent"
                onClick={onStart}
                disabled={!canStartRound}
                className={[
                  "w-full",
                  !canStartRound
                    ? "bg-zinc-300 text-zinc-600 disabled:opacity-100"
                    : "",
                ].join(" ")}
              >
                {isGenerating || actionBusy === "start" ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isGenerating
                  ? copy.lobby.generatingTheme
                  : copy.lobby.startRound}
              </Button>
            ) : (
              <p className="flex items-center rounded-[12px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 text-sm font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_70%,white)]">
                {isGenerating ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {isGenerating
                  ? copy.lobby.generatingTheme
                  : copy.lobby.waitingForHost}
              </p>
            )}

            {lobbyStatusMessage ? (
              <p
                className={[
                  "mt-2 text-xs font-semibold",
                  "text-[var(--pmb-red)]",
                ].join(" ")}
              >
                {lobbyStatusMessage}
              </p>
            ) : null}

            {!lobbyStatusMessage && preparationMessage ? (
              <p className="mt-2 text-xs font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_72%,white)]">
                {preparationMessage}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="relative flex min-w-0 flex-col overflow-x-hidden bg-white p-3 md:p-3.5 lg:min-h-0">
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-2 text-3xl leading-none font-black md:text-[2.15rem]">
              <Gamepad2 className="h-6 w-6" /> {copy.lobby.gameMode}
            </h2>
          </div>

          {settingsStatusMessage ? (
            <div
              className={[
                "mt-2 flex items-center gap-1.5 text-[11px] font-semibold",
                "text-[var(--pmb-red)]",
              ].join(" ")}
            >
              <span>{settingsStatusMessage}</span>
            </div>
          ) : null}

          <div className="mt-3 grid min-h-0 items-stretch gap-3 xl:grid-cols-[minmax(150px,0.24fr)_minmax(0,0.76fr)]">
            <div className="grid min-h-0 gap-2">
              {gameModeOptions.map((mode) => {
                const selected = draftGameMode === mode.mode;
                const Icon =
                  mode.mode === "classic"
                    ? Eye
                    : mode.mode === "memory"
                      ? Brain
                      : mode.mode === "change"
                        ? Sparkles
                        : Ghost;

                return (
                  <button
                    key={mode.mode}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (!hostCanEdit) return;
                      const enteringChangeMode =
                        mode.mode === "change" && draftGameMode !== "change";
                      const leavingChangeMode =
                        draftGameMode === "change" && mode.mode !== "change";
                      setDraftGameMode(mode.mode);
                      setDraftRoundSeconds(
                        enteringChangeMode
                          ? CHANGE_DEFAULT_ROUND_SECONDS
                          : leavingChangeMode
                            ? STANDARD_DEFAULT_ROUND_SECONDS
                            : normalizeRoundSecondsForMode(
                                mode.mode,
                                draftRoundSeconds,
                              ),
                      );
                    }}
                    disabled={!hostCanEdit}
                    className={[
                      "group relative flex min-h-[72px] w-full items-center justify-between gap-2 overflow-hidden rounded-[16px] border-4 px-3 py-2 text-left transition-all duration-150",
                      "disabled:cursor-not-allowed disabled:opacity-70",
                      selected
                        ? "border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[5px_5px_0_var(--pmb-ink)]"
                        : "border-[var(--pmb-ink)] bg-[var(--pmb-base)] shadow-[3px_3px_0_var(--pmb-ink)] hover:-translate-y-0.5 hover:bg-white hover:shadow-[4px_4px_0_var(--pmb-ink)]",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center">
                      <span className="block truncate text-[0.98rem] leading-tight font-black">
                        {mode.label}
                      </span>
                    </span>
                    <span
                      className={[
                        "grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[var(--pmb-ink)] bg-white transition-transform duration-150",
                        selected ? "rotate-[-5deg]" : "group-hover:rotate-6",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="min-w-0" aria-live="polite">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentMode.mode}
                  initial={{ opacity: 0, x: 18, rotate: 0.4, scale: 0.98 }}
                  animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -14, rotate: -0.4, scale: 0.98 }}
                  transition={{ type: "spring", bounce: 0.24, duration: 0.36 }}
                  className="relative isolate h-full min-h-[312px] overflow-hidden rounded-[18px] border-4 border-[var(--pmb-ink)] bg-[linear-gradient(135deg,#fff_0%,var(--pmb-base)_100%)] p-3 shadow-[5px_5px_0_var(--pmb-ink)]"
                >
                  <div className="absolute inset-x-0 top-0 h-3 border-b-4 border-[var(--pmb-ink)] bg-[repeating-linear-gradient(90deg,var(--pmb-yellow)_0_18px,var(--pmb-blue)_18px_36px,var(--pmb-green)_36px_54px,var(--pmb-red)_54px_72px)]" />
                  <motion.div
                    className="absolute top-7 right-5 h-7 w-7 rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)]"
                    animate={{ y: [0, -7, 0], rotate: [0, 10, 0] }}
                    transition={{
                      duration: 2.6,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />

                  <div className="relative z-10 flex h-full min-h-[284px] flex-col gap-3 pt-3 sm:flex-row">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="text-[1.65rem] leading-none font-black md:text-[1.9rem]">
                        {currentMode.label}
                      </h3>
                      <p className="mt-2 max-w-[34rem] text-[13px] leading-[1.45] font-bold md:text-sm">
                        {currentMode.description}
                      </p>
                      <div className="mt-auto flex items-start gap-2 rounded-[14px] border-2 border-[var(--pmb-ink)] bg-white px-3 py-2 shadow-[3px_3px_0_var(--pmb-ink)]">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pmb-orange)]" />
                        <p className="text-xs leading-[1.35] font-black">
                          {currentMode.lobbyHint}
                        </p>
                      </div>
                    </div>

                    <motion.div
                      className="relative min-h-[148px] overflow-hidden rounded-[16px] border-4 border-[var(--pmb-ink)] bg-white shadow-[4px_4px_0_var(--pmb-ink)] sm:min-h-0 sm:flex-[0.95]"
                      style={{
                        backgroundImage: `url(${MODE_PREVIEW_IMAGES[currentMode.mode]})`,
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                      }}
                      animate={{ y: [0, -5, 0], rotate: [-0.6, 0.7, -0.6] }}
                      transition={{
                        duration: 4.4,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    >
                      <Image
                        key={`${currentMode.mode}-preview`}
                        src={MODE_PREVIEW_IMAGES[currentMode.mode]}
                        alt={currentMode.label}
                        fill
                        priority
                        unoptimized
                        sizes="(min-width: 1280px) 28vw, (min-width: 640px) 38vw, 92vw"
                        className="object-cover"
                      />
                      <div className="absolute right-2 bottom-2 rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-blue)] p-2 shadow-[2px_2px_0_var(--pmb-ink)]">
                        <Play className="h-4 w-4 fill-[var(--pmb-ink)]" />
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="mt-4 border-t-4 border-[var(--pmb-ink)] pt-3 md:mt-5">
            <h3 className="flex items-center gap-2 text-2xl leading-none md:text-[1.85rem]">
              <ListChecks className="h-6 w-6" />
              {language === "ja" ? "ゲームルール" : "Game Rule"}
            </h3>
          </div>

          <div className="mt-2 space-y-2">
            <SwipeValuePicker
              label="Rounds"
              icon={RotateCcw}
              options={ROUND_OPTIONS}
              value={draftTotalRounds}
              onChange={setDraftTotalRounds}
              disabled={!hostCanEdit}
            />

            <SwipeValuePicker
              label={
                draftGameMode === "change" ? copy.lobby.repeatViews : "Time"
              }
              icon={Clock3}
              options={roundTimeOptions}
              value={draftRoundSeconds}
              onChange={setDraftRoundSeconds}
              disabled={!hostCanEdit}
            />
            {draftGameMode !== "change" ? (
              <SwipeValuePicker
                label="CPU"
                icon={Bot}
                options={cpuOptions}
                value={draftCpuCount}
                onChange={setDraftCpuCount}
                disabled={!hostCanEdit}
              />
            ) : null}
          </div>

          {settingsStatus === "saving" ? (
            <div className="pointer-events-none absolute right-3 bottom-3 rounded-full border-2 border-[var(--pmb-ink)] bg-white p-2 shadow-[3px_3px_0_var(--pmb-ink)]">
              <LoaderCircle className="h-4 w-4 animate-spin" />
            </div>
          ) : null}
        </Card>
      </section>
    </main>
  );
}
