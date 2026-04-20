"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronsUpDown,
  Copy,
  Eye,
  Ghost,
  LoaderCircle,
  LogOut,
  Play,
  Settings2,
  Shuffle,
  Users,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { buildCurrentAppPath } from "@/lib/client/paths";
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
import {
  resolveUiErrorMessage,
  toUiError,
  type UiError,
} from "@/lib/i18n/errors";
import { useRoomSync } from "@/lib/client/room-sync";
import { getGameModeDefinition, getGameModeOptions } from "@/lib/game/modes";
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
  options: readonly PickerOption[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

interface PlayerReadyChipProps {
  ready: boolean;
  isSelf: boolean;
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const SWIPE_THRESHOLD = 28;

const ROUND_OPTIONS: readonly PickerOption[] = [
  {
    value: 1,
    label: "1",
    unitLabel: "ROUND",
  },
  {
    value: 2,
    label: "2",
    unitLabel: "ROUNDS",
  },
  {
    value: 3,
    label: "3",
    unitLabel: "ROUNDS",
  },
];

const ROUND_TIME_OPTIONS: readonly PickerOption[] = [
  {
    value: 30,
    label: "30",
    unitLabel: "SEC",
  },
  {
    value: 45,
    label: "45",
    unitLabel: "SEC",
  },
  {
    value: 60,
    label: "60",
    unitLabel: "SEC",
  },
];

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
  const previousOption = options[currentIndex - 1] ?? null;
  const nextOption = options[currentIndex + 1] ?? null;
  const currentIndexRef = useRef(currentIndex);
  const dragStartYRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const movedRef = useRef(false);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const shiftIndex = (delta: number) => {
    if (disabled || delta === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(options.length - 1, currentIndexRef.current + delta),
    );
    if (nextIndex === currentIndexRef.current) return;
    currentIndexRef.current = nextIndex;
    onChange(options[nextIndex]!.value);
  };

  const finishDrag = (
    event: PointerEvent<HTMLButtonElement>,
    activateClickStep: boolean,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStartYRef.current = null;
    dragOffsetRef.current = 0;

    if (activateClickStep && !movedRef.current) {
      shiftIndex(1);
    }

    movedRef.current = false;
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    dragStartYRef.current = event.clientY;
    dragOffsetRef.current = 0;
    movedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || dragStartYRef.current == null) return;

    dragOffsetRef.current += event.clientY - dragStartYRef.current;
    dragStartYRef.current = event.clientY;

    while (dragOffsetRef.current <= -SWIPE_THRESHOLD) {
      movedRef.current = true;
      dragOffsetRef.current += SWIPE_THRESHOLD;
      shiftIndex(-1);
    }

    while (dragOffsetRef.current >= SWIPE_THRESHOLD) {
      movedRef.current = true;
      dragOffsetRef.current -= SWIPE_THRESHOLD;
      shiftIndex(1);
    }
  };

  const onWheel = (event: WheelEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    shiftIndex(event.deltaY > 0 ? 1 : -1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      shiftIndex(-1);
      return;
    }

    if (event.key === "ArrowDown") {
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
    <div className="rounded-[16px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-2.5">
      <p className="text-[11px] font-black tracking-[0.2em] uppercase">
        {label}
      </p>

      <button
        type="button"
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        className={[
          "relative mt-2 h-[88px] w-full overflow-hidden rounded-[14px] border-4 border-[var(--pmb-ink)] bg-white text-center transition-transform duration-150",
          "cursor-ns-resize touch-none shadow-[4px_4px_0_var(--pmb-ink)]",
          "hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--pmb-ink)]",
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
        <span className="pointer-events-none absolute inset-x-0 top-0.5 text-[10px] font-black tracking-[0.16em] text-[color:color-mix(in_srgb,var(--pmb-ink)_40%,white)] uppercase">
          {previousOption
            ? [previousOption.label, previousOption.unitLabel]
                .filter(Boolean)
                .join(" ")
            : ""}
        </span>

        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2">
          <ChevronsUpDown className="h-4 w-4 shrink-0" />
          <span className="text-[2.55rem] leading-none font-black tracking-[-0.04em]">
            {selectedOption.label}
          </span>
          {selectedOption.unitLabel ? (
            <span className="text-[11px] font-black tracking-[0.2em] uppercase">
              {selectedOption.unitLabel}
            </span>
          ) : null}
        </span>

        <span className="pointer-events-none absolute inset-x-0 bottom-0.5 text-[10px] font-black tracking-[0.16em] text-[color:color-mix(in_srgb,var(--pmb-ink)_40%,white)] uppercase">
          {nextOption
            ? [nextOption.label, nextOption.unitLabel].filter(Boolean).join(" ")
            : ""}
        </span>
      </button>
    </div>
  );
}

function PlayerReadyChip({
  ready,
  isSelf,
  pending,
  disabled = false,
  onClick,
}: PlayerReadyChipProps) {
  const { copy } = useLanguage();
  const toneClass = ready
    ? "bg-[var(--pmb-green)] text-[var(--pmb-ink)]"
    : "bg-[var(--pmb-red)] text-white";
  const baseClass =
    "inline-flex min-w-[92px] items-center justify-center rounded-full border-2 border-[var(--pmb-ink)] px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em]";

  if (isSelf) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending || disabled}
        className={[
          baseClass,
          toneClass,
          "shadow-[4px_4px_0_var(--pmb-ink)] transition-transform duration-150",
          "hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--pmb-ink)]",
          "disabled:cursor-not-allowed disabled:opacity-80 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
      >
        {pending ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : ready ? (
          copy.common.ready
        ) : (
          copy.common.wait
        )}
      </button>
    );
  }

  return (
    <span className={[baseClass, toneClass].join(" ")}>
      {ready ? copy.common.ready : copy.common.wait}
    </span>
  );
}

export default function LobbyPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { language, copy } = useLanguage();
  const { user, loading, error: authError } = useAuth();
  const {
    snapshot,
    error: snapshotError,
    isConnecting,
  } = useRoomSync({
    roomId,
    view: "lobby",
    enabled: Boolean(user) && !loading,
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

  const room = snapshot.room;
  const players = snapshot.players;
  const displayPlayers = players.map((player) =>
    player.uid === user?.uid && optimisticReady !== null
      ? { ...player, ready: optimisticReady }
      : player,
  );
  const me = displayPlayers.find((player) => player.uid === user?.uid) ?? null;
  const currentGameMode = room?.settings?.gameMode ?? "classic";
  const currentImageModel = room?.settings?.imageModel ?? "gemini";
  const currentTotalRounds = room?.settings?.totalRounds ?? 1;
  const currentRoundSeconds = room?.settings?.roundSeconds ?? 60;
  const currentCpuCount = room?.settings?.cpuCount ?? 0;
  const displayGameMode =
    me?.isHost && draftsReady ? draftGameMode : currentGameMode;
  const displayTotalRounds =
    me?.isHost && draftsReady ? draftTotalRounds : currentTotalRounds;
  const displayRoundSeconds =
    me?.isHost && draftsReady ? draftRoundSeconds : currentRoundSeconds;
  const displayCpuCount =
    me?.isHost && draftsReady ? draftCpuCount : currentCpuCount;
  const nextRoundPreparation = room?.nextRoundPreparation ?? null;
  const currentMode = getGameModeDefinition(displayGameMode, language);
  const gameModeOptions = getGameModeOptions(language);
  const imageModelLabel =
    currentImageModel === "flux"
      ? copy.lobby.fluxModel
      : copy.lobby.geminiModel;
  const readyCount = displayPlayers.filter((player) => player.ready).length;
  const everyoneReady =
    displayPlayers.length > 0 && readyCount === displayPlayers.length;
  const humanPlayerCount = displayPlayers.filter(
    (player) => player.kind === "human",
  ).length;
  const maxPlayers = room?.settings?.maxPlayers ?? 8;
  const maxCpuCount = Math.max(0, Math.min(6, maxPlayers - humanPlayerCount));
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
    draftGameMode === "impostor" ? draftCpuCount : 0,
  );
  const settingsDirty = currentSettingsKey !== draftSettingsKey;
  const canStartRound =
    Boolean(me?.isHost) &&
    displayPlayers.length >= (displayGameMode === "impostor" ? 2 : 1) &&
    everyoneReady &&
    !isGenerating &&
    actionBusy === null;
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
          cpuCount: draftGameMode === "impostor" ? draftCpuCount : 0,
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
    enabled: Boolean(room && user),
  });

  const onToggleReady = async () => {
    if (!me || isGenerating) return;

    setActionBusy("ready");
    setActionError(null);
    const nextReady = !me.ready;
    setOptimisticReady(nextReady);
    try {
      await apiPost("/api/rooms/ready", {
        roomId,
        ready: nextReady,
      });
    } catch (error) {
      setOptimisticReady(null);
      setActionError(toUiError(error, "readyUpdateFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const onStart = async () => {
    if (!me?.isHost || !canStartRound) return;

    setActionBusy("start");
    setActionError(null);
    try {
      if (settingsDirty && hostCanEdit) {
        await apiPost("/api/rooms/settings", {
          roomId,
          settings: {
            gameMode: draftGameMode,
            totalRounds: draftTotalRounds,
            roundSeconds: draftRoundSeconds,
            cpuCount: draftGameMode === "impostor" ? draftCpuCount : 0,
          },
        });
        setSettingsStatus("saved");
        setSettingsError(null);
      }

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
    setActionBusy("leave");
    setActionError(null);
    try {
      await leaveRoom({ roomId });
      router.replace(buildCurrentAppPath("/"));
    } catch (error) {
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

  if (loading || (isConnecting && !snapshotError && !room)) {
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
    <main className="page-enter mx-auto flex h-[100dvh] w-full max-w-7xl flex-col gap-2 overflow-hidden px-3 py-3 md:px-4 md:py-3">
      <Card className="overflow-hidden bg-white p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 bg-[var(--pmb-yellow)] px-4 py-3 md:px-5">
          <div>
            <p className="text-[11px] font-black tracking-[0.24em] uppercase">
              {copy.lobby.roomCode}
            </p>
            <div className="mt-1 flex items-center gap-2">
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
            </div>
          </div>

          <div className="flex items-stretch gap-2 self-stretch">
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

      <section className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
        <Card className="relative flex min-h-0 flex-col bg-white p-3 md:p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-2xl md:text-[1.7rem]">
              <Users className="h-5 w-5" /> {copy.lobby.players}
            </h2>
            <Badge
              className={
                everyoneReady
                  ? "bg-[var(--pmb-green)] text-[var(--pmb-ink)]"
                  : "bg-[var(--pmb-base)] text-[var(--pmb-ink)]"
              }
            >
              {displayPlayers.length > 0
                ? copy.lobby.readyCount(readyCount, displayPlayers.length)
                : copy.lobby.readyCount(0, 0)}
            </Badge>
          </div>

          <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {displayPlayers.map((player) => (
              <div
                key={player.uid}
                className="flex items-center justify-between gap-2 rounded-[14px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-black md:text-[15px]">
                    {player.displayName}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {player.kind === "cpu" ? (
                      <Badge className="bg-[var(--pmb-base)] px-2 py-0 text-[10px]">
                        <Bot className="mr-1 h-3 w-3" /> {copy.common.cpu}
                      </Badge>
                    ) : null}
                    {player.uid === user?.uid ? (
                      <Badge className="bg-white px-2 py-0 text-[10px]">
                        {copy.common.you}
                      </Badge>
                    ) : null}
                    {player.isHost ? (
                      <Badge className="px-2 py-0 text-[10px]">
                        {copy.common.host}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <PlayerReadyChip
                  ready={player.ready}
                  isSelf={player.uid === user?.uid}
                  pending={player.uid === user?.uid && actionBusy === "ready"}
                  disabled={isGenerating}
                  onClick={onToggleReady}
                />
              </div>
            ))}
          </div>

          <div className="relative mt-3 border-t-4 border-[var(--pmb-ink)] pt-2">
            {me?.isHost ? (
              <div className="absolute right-0 bottom-full mb-3">
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

        <Card className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-white p-3 md:p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-2xl md:text-[1.7rem]">
              <Settings2 className="h-5 w-5" /> {copy.lobby.gameSettings}
            </h2>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                {currentMode.label}
              </Badge>
              <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                {imageModelLabel}
              </Badge>
              <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                {displayTotalRounds} {copy.common.rounds}
              </Badge>
              <Badge className="bg-[var(--pmb-base)] px-2.5 py-0.5 text-[11px]">
                {displayRoundSeconds} {copy.common.seconds}
              </Badge>
              {displayGameMode === "impostor" ? (
                <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                  {displayCpuCount} {copy.common.cpu}
                </Badge>
              ) : null}
              <Badge className="bg-white px-2.5 py-0.5 text-[11px]">
                {displayPlayers.length} {copy.common.players}
              </Badge>
            </div>
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

          <div className="mt-3">
            <h3 className="text-lg leading-none md:text-xl">
              {copy.lobby.gameMode}
            </h3>
          </div>

          <div className="-mx-1 mt-2 overflow-x-auto overflow-y-hidden px-1 pb-0.5">
            <div className="flex min-w-max snap-x snap-mandatory gap-2 lg:min-w-0 lg:flex-wrap">
              {gameModeOptions.map((mode) => {
                const selected = draftGameMode === mode.mode;
                const Icon =
                  mode.mode === "classic"
                    ? Eye
                    : mode.mode === "memory"
                      ? Brain
                      : Ghost;

                return (
                  <button
                    key={mode.mode}
                    type="button"
                    onClick={() => setDraftGameMode(mode.mode)}
                    disabled={!hostCanEdit}
                    className={[
                      "flex min-h-[146px] w-[min(78vw,320px)] snap-start flex-col rounded-[16px] border-4 p-2.5 text-left transition-transform duration-150 lg:min-h-[138px] lg:min-w-[260px] lg:flex-1 lg:basis-[280px]",
                      "disabled:cursor-not-allowed disabled:opacity-70",
                      selected
                        ? "border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[5px_5px_0_var(--pmb-ink)]"
                        : "border-[var(--pmb-ink)] bg-[var(--pmb-base)] shadow-[3px_3px_0_var(--pmb-ink)]",
                    ].join(" ")}
                  >
                    <div className="flex min-h-[60px] items-start justify-between gap-3">
                      <div className="flex min-h-[46px] flex-col justify-start">
                        <p className="text-[11px] font-black tracking-[0.18em] uppercase">
                          {mode.englishName}
                        </p>
                        <h3 className="mt-1 text-lg leading-tight font-black">
                          {mode.label}
                        </h3>
                      </div>
                      <div className="shrink-0 rounded-full border-2 border-[var(--pmb-ink)] bg-white p-1.5">
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="mt-2 min-h-[2.45rem] text-[13px] leading-[1.3] font-semibold">
                      {mode.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <h3 className="text-lg leading-none md:text-xl">
              {copy.lobby.advancedSettings}
            </h3>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <SwipeValuePicker
              label="Rounds"
              options={ROUND_OPTIONS}
              value={draftTotalRounds}
              onChange={setDraftTotalRounds}
              disabled={!hostCanEdit}
            />

            <SwipeValuePicker
              label="Time"
              options={ROUND_TIME_OPTIONS}
              value={draftRoundSeconds}
              onChange={setDraftRoundSeconds}
              disabled={!hostCanEdit}
            />
            {draftGameMode === "impostor" ? (
              <SwipeValuePicker
                label="CPU"
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
