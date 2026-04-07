"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  Check,
  Copy,
  Eye,
  LoaderCircle,
  LogOut,
  Play,
  Settings2,
  Users,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
import { useRoomSync } from "@/lib/client/room-sync";
import {
  GAME_MODE_OPTIONS,
  getGameModeDefinition,
} from "@/lib/game/modes";
import type { GameMode } from "@/lib/types/game";

export default function LobbyPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { user, loading } = useAuth();
  const { snapshot } = useRoomSync({
    roomId,
    view: "lobby",
    enabled: Boolean(user) && !loading,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">("idle");
  const [draftGameMode, setDraftGameMode] = useState<GameMode>("classic");
  const [draftTotalRounds, setDraftTotalRounds] = useState(3);

  const room = snapshot.room;
  const players = snapshot.players;

  useEffect(() => {
    if (!room) return;
    if (room.status === "IN_ROUND") {
      router.replace(`/round/${roomId}`);
    }
    if (room.status === "FINISHED") {
      router.replace("/");
    }
  }, [room, roomId, router]);

  const me = useMemo(
    () => players.find((player) => player.uid === user?.uid) ?? null,
    [players, user?.uid],
  );

  const currentGameMode = room?.settings?.gameMode ?? "classic";
  const currentTotalRounds = room?.settings?.totalRounds ?? 3;
  const currentMode = getGameModeDefinition(currentGameMode);

  useEffect(() => {
    setDraftGameMode(currentGameMode);
  }, [currentGameMode]);

  useEffect(() => {
    setDraftTotalRounds(currentTotalRounds);
  }, [currentTotalRounds]);

  const isGenerating = room?.status === "GENERATING_ROUND";
  const showGeneratingBanner = isGenerating && !error;
  const everyoneReady = players.length > 0 && players.every((player) => player.ready);
  const canStartRound =
    Boolean(me?.isHost) && players.length >= 1 && everyoneReady && !isGenerating && !busy;
  const settingsChanged =
    draftGameMode !== currentGameMode || draftTotalRounds !== currentTotalRounds;
  const canSaveSettings =
    Boolean(me?.isHost) && !busy && !isGenerating && Boolean(room) && settingsChanged;

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user),
  });

  const onReady = async () => {
    if (!me || me.ready) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/rooms/ready", {
        roomId,
        ready: true,
      });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("Ready更新に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const onSaveSettings = async () => {
    if (!canSaveSettings) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/rooms/settings", {
        roomId,
        settings: {
          gameMode: draftGameMode,
          totalRounds: draftTotalRounds,
        },
      });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("ルール更新に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const onStart = async () => {
    if (!me?.isHost) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/rounds/start", {
        roomId,
      });
      router.push(`/round/${roomId}`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("ラウンド開始に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!room?.code) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopyStatus("done");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 1800);
    }
  };

  const onLeave = async () => {
    setBusy(true);
    setError(null);
    try {
      await leaveRoom({ roomId });
      router.replace("/");
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("退出に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading || !room) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">読み込み中...</Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex h-screen max-h-screen w-full max-w-7xl flex-col gap-4 overflow-hidden px-4 py-4 md:px-6 md:py-5">
      <Card className="overflow-hidden bg-white p-0">
        <section>
          <div className="bg-[var(--pmb-yellow)] p-5 md:p-6">
            <p className="text-xs font-black uppercase tracking-[0.22em]">Room Lobby</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <h1 className="font-mono text-4xl font-black tracking-[0.28em] md:text-5xl">
                  {room.code}
                </h1>
                <Button
                  onClick={copyCode}
                  type="button"
                  variant="ghost"
                  aria-label={copyStatus === "done" ? "コピー済み" : "ルームコードをコピー"}
                  className={[
                    "h-11 w-11 p-0",
                    "hover:translate-x-0 hover:-translate-y-0 hover:shadow-[6px_6px_0_var(--pmb-ink)]",
                    "active:translate-x-0.5 active:translate-y-0.5 active:shadow-[4px_4px_0_var(--pmb-ink)]",
                    copyStatus === "done" ? "bg-[var(--pmb-green)] text-[var(--pmb-ink)]" : "",
                  ].join(" ")}
                >
                  {copyStatus === "done" ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-white">{currentMode.label}</Badge>
                <Badge className="bg-[var(--pmb-blue)]">{currentTotalRounds} ROUNDS</Badge>
                <Badge className="bg-[var(--pmb-base)] text-[var(--pmb-ink)]">
                  {players.length} PLAYERS
                </Badge>
              </div>
            </div>
            {copyStatus === "done" ? (
              <p className="mt-2 text-xs font-semibold">ルームコードをコピーしました。</p>
            ) : null}
            {copyStatus === "error" ? (
              <p className="mt-2 text-xs font-semibold text-[var(--pmb-red)]">
                コピーに失敗しました。
              </p>
            ) : null}
          </div>
        </section>
      </Card>

      <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <Card className="flex min-h-0 flex-col bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl">
            <Users className="h-5 w-5" /> プレイヤー ({players.length})
          </h2>
          <div className="mt-3 min-h-0 space-y-2 overflow-y-auto pr-1">
            {players.map((player) => (
              <div
                key={player.uid}
                className="flex items-center justify-between rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-4 py-2.5"
              >
                <div className="flex items-center gap-2 text-sm font-semibold md:text-base">
                  <span>{player.displayName}</span>
                  {player.uid === user?.uid ? <Badge className="bg-white">YOU</Badge> : null}
                  {player.isHost ? <Badge>HOST</Badge> : null}
                </div>
                <Badge
                  className={
                    player.ready
                      ? "bg-[var(--pmb-green)] text-[var(--pmb-ink)]"
                      : "bg-[var(--pmb-red)] text-white"
                  }
                >
                  {player.ready ? "READY" : "WAITING"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl">
              <Settings2 className="h-5 w-5" /> ゲーム設定
            </h2>
            <Badge className={me?.isHost ? "bg-[var(--pmb-blue)]" : "bg-[var(--pmb-base)]"}>
              {me?.isHost ? "HOST CONTROL" : "READ ONLY"}
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {GAME_MODE_OPTIONS.map((mode) => {
              const selected = draftGameMode === mode.mode;
              const Icon = mode.mode === "classic" ? Eye : Brain;

              return (
                <button
                  key={mode.mode}
                  type="button"
                  onClick={() => setDraftGameMode(mode.mode)}
                  disabled={!me?.isHost || busy || isGenerating}
                  className={[
                    "rounded-[18px] border-4 p-4 text-left transition-transform duration-150",
                    "disabled:cursor-not-allowed disabled:opacity-70",
                    selected
                      ? "border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[7px_7px_0_var(--pmb-ink)]"
                      : "border-[var(--pmb-ink)] bg-[var(--pmb-base)] shadow-[5px_5px_0_var(--pmb-ink)]",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em]">
                        {mode.mode === "classic" ? "Classic" : "Memory"}
                      </p>
                      <h3 className="mt-1 text-xl font-black">{mode.label}</h3>
                    </div>
                    <div className="rounded-full border-2 border-[var(--pmb-ink)] bg-white p-2">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-relaxed">{mode.description}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <p className="text-xs font-black uppercase tracking-[0.18em]">Rounds</p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((roundCount) => (
                <button
                  key={roundCount}
                  type="button"
                  onClick={() => setDraftTotalRounds(roundCount)}
                  disabled={!me?.isHost || busy || isGenerating}
                  className={[
                    "rounded-[14px] border-4 px-2 py-3 text-center font-black transition-transform duration-150",
                    "disabled:cursor-not-allowed disabled:opacity-70",
                    draftTotalRounds === roundCount
                      ? "border-[var(--pmb-ink)] bg-[var(--pmb-blue)] shadow-[6px_6px_0_var(--pmb-ink)]"
                      : "border-[var(--pmb-ink)] bg-[var(--pmb-base)] shadow-[4px_4px_0_var(--pmb-ink)]",
                  ].join(" ")}
                >
                  <span className="block text-2xl leading-none">{roundCount}</span>
                  <span className="mt-1 block text-xs">ROUND</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Button
              type="button"
              className={[
                "w-full disabled:opacity-100",
                me?.ready ? "bg-zinc-300 text-zinc-600" : "bg-white text-[var(--pmb-ink)]",
              ].join(" ")}
              variant="ghost"
              onClick={onReady}
              disabled={!me || busy || isGenerating || Boolean(me?.ready)}
            >
              READY！
            </Button>

            <Button
              type="button"
              className={[
                "w-full",
                !canStartRound ? "bg-zinc-300 text-zinc-600 disabled:opacity-100" : "",
              ].join(" ")}
              variant="accent"
              onClick={onStart}
              disabled={!canStartRound}
            >
              <Play className="mr-2 h-4 w-4" />
              {isGenerating ? "お題生成中..." : "ラウンド開始"}
            </Button>

            <Button type="button" variant="ghost" onClick={onLeave} disabled={busy}>
              <LogOut className="mr-2 h-4 w-4" />
              退出
            </Button>
          </div>

          <div className="mt-3 flex flex-col gap-3">
            <Button
              type="button"
              variant="accent"
              onClick={onSaveSettings}
              disabled={!canSaveSettings}
              className={!canSaveSettings ? "bg-zinc-300 text-zinc-600 disabled:opacity-100" : ""}
            >
              ルールを更新
            </Button>
            <p className="text-xs font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_72%,white)]">
              {me?.isHost
                ? "設定変更後も READY 状態はそのまま維持されます。"
                : "ホストがロビー中にだけルールを変更できます。"}
            </p>
          </div>
        </Card>
      </section>

      {showGeneratingBanner ? (
        <Card className="flex items-center gap-2 border-[var(--pmb-blue)] bg-white text-sm font-semibold">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          お題画像を生成中です。完了すると自動でラウンド画面へ遷移します。
        </Card>
      ) : null}

      {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
    </main>
  );
}
