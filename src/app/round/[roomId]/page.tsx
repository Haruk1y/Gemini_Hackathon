"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { Brain, Eye, EyeOff, LoaderCircle, LogOut, Send } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { CountdownTimer } from "@/components/game/countdown-timer";
import { Scoreboard } from "@/components/game/scoreboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { placeholderImageUrl } from "@/lib/client/image";
import { useRoomPresence } from "@/lib/client/room-presence";
import {
  type AttemptData,
  type RoomData,
  type RoundData,
  type ScoreEntry,
  useRoomSync,
} from "@/lib/client/room-sync";
import {
  MEMORY_PREVIEW_SECONDS,
  getGameModeDefinition,
} from "@/lib/game/modes";
import { formatSeconds, millisecondsLeft, parseDate } from "@/lib/utils/time";

type SubmitResponse = Record<string, unknown> & {
  ok: true;
  score: number;
  imageUrl: string;
};

export default function RoundPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();

  const { user } = useAuth();
  const { snapshot } = useRoomSync({ roomId, view: "round", enabled: Boolean(user) });

  const [room, setRoom] = useState<RoomData | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [attempts, setAttempts] = useState<AttemptData | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [previewSecondsLeft, setPreviewSecondsLeft] = useState<number | null>(null);
  const [resultCountdownSeconds, setResultCountdownSeconds] = useState<number | null>(null);

  const endCalled = useRef(false);
  const derivedRoom = snapshot.room as RoomData | null;
  const derivedRound = snapshot.round as RoundData | null;
  const derivedScores = snapshot.scores as ScoreEntry[];
  const derivedAttempts = snapshot.attempts as AttemptData | null;
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
  }, [derivedAttempts, derivedPlayerCount, derivedRound, derivedRoom, derivedScores]);

  const currentGameMode = room?.settings?.gameMode ?? "classic";
  const currentMode = getGameModeDefinition(currentGameMode);
  const roundSeconds = room?.settings?.roundSeconds ?? 60;

  useEffect(() => {
    if (!round || !room) {
      setSecondsLeft(0);
      setPreviewSecondsLeft(null);
      return;
    }

    if (room.status !== "IN_ROUND" || round.status !== "IN_ROUND" || !round.endsAt) {
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
          Math.max(0, Math.ceil((promptStartsAt.getTime() - Date.now()) / 1000)),
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
  }, [currentGameMode, round, room, roundSeconds]);

  useEffect(() => {
    endCalled.current = false;
  }, [round?.roundId, room?.status]);

  useEffect(() => {
    if (!room || !round) return;

    if (room.status === "RESULTS") {
      router.replace(`/results/${roomId}`);
      return;
    }

    if (room.status === "LOBBY") {
      router.replace(`/lobby/${roomId}`);
      return;
    }

    if (room.status === "FINISHED") {
      router.replace("/");
      return;
    }

    if (room.status !== "IN_ROUND" || round.status !== "IN_ROUND") return;
    if (secondsLeft > 0 || endCalled.current) return;

    endCalled.current = true;
    void apiPost("/api/rounds/endIfNeeded", {
      roomId,
      roundId: round.roundId,
    }).catch((err) => {
      console.error("endIfNeeded failed", err);
      endCalled.current = false;
    });
  }, [secondsLeft, room, round, roomId, router]);

  const latestAttempt = attempts?.attempts?.[attempts.attempts.length - 1] ?? null;
  const attemptsLeft = Math.max(
    0,
    (room?.settings?.maxAttempts ?? 0) - (attempts?.attemptsUsed ?? 0),
  );
  const isRoundLive = room?.status === "IN_ROUND" && round?.status === "IN_ROUND";
  const isBusy = submitPending;
  const otherBestImages = scores.filter(
    (entry) => entry.uid !== user?.uid && entry.bestImageUrl,
  );
  const latestAttemptScoring = Boolean(
    latestAttempt &&
      (latestAttempt.status === "SCORING" || latestAttempt.score == null),
  );
  const everyoneScored = playerCount > 0 && scores.length >= playerCount;
  const autoEndingSoon = everyoneScored && isRoundLive;
  const isPreviewPhase =
    currentGameMode === "memory" &&
    isRoundLive &&
    previewSecondsLeft !== null &&
    previewSecondsLeft > 0;
  const promptLocked = isPreviewPhase;
  const shouldShowTargetImage = currentGameMode === "classic" || isPreviewPhase;
  const imageFrameClass =
    "relative h-64 w-full overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-white sm:h-72 lg:h-[min(34vh,320px)]";

  useEffect(() => {
    if (!autoEndingSoon) {
      setResultCountdownSeconds(null);
      return;
    }

    const parsedEndsAt = parseDate(round?.endsAt);
    const fallbackEndsAt = new Date(Date.now() + 10_000);
    const countdownTarget =
      parsedEndsAt && parsedEndsAt.getTime() > Date.now() ? parsedEndsAt : fallbackEndsAt;

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
      if (e instanceof ApiClientError) {
        setFeedback(e.message);
      } else {
        setFeedback("投稿に失敗しました");
      }
    } finally {
      setSubmitPending(false);
    }
  };

  const onBackToLobby = () => {
    router.push(`/results/${roomId}?from=round`);
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">ラウンド準備中...</Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 md:px-6 lg:h-screen lg:max-h-screen lg:overflow-hidden">
      <Card className="bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-2xl font-black uppercase leading-none md:text-3xl">
                Round {round.index}
              </p>
              <Badge className={currentGameMode === "memory" ? "bg-[var(--pmb-blue)]" : ""}>
                {currentMode.label}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-relaxed">
              {currentMode.roundBanner}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isPreviewPhase ? (
              <Card className="bg-[var(--pmb-blue)] px-4 py-2 shadow-[6px_6px_0_var(--pmb-ink)]">
                <p className="text-xs font-black uppercase tracking-[0.18em]">
                  Memory Preview
                </p>
                <p className="mt-1 font-mono text-2xl font-black">
                  {formatSeconds(previewSecondsLeft ?? MEMORY_PREVIEW_SECONDS)}
                </p>
              </Card>
            ) : (
              <CountdownTimer secondsLeft={secondsLeft} />
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
                ? `リザルト画面へ（残り${resultCountdownSeconds ?? 10}秒）`
                : "リザルト画面へ"}
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-[18px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            {isPreviewPhase ? (
              <>
                <Brain className="h-5 w-5" />
                <p className="text-lg font-black">記憶タイム</p>
              </>
            ) : (
              <>
                <Eye className="h-5 w-5" />
                <p className="text-lg font-black">プロンプト作成タイム</p>
              </>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold leading-relaxed">
            {isPreviewPhase
              ? `あと${previewSecondsLeft ?? MEMORY_PREVIEW_SECONDS}秒だけ見られます。画像を覚えたら入力フェーズが始まります。`
              : "見えた情報をもとに、最も近い画像になるプロンプトを1回で作ろう。"}
          </p>
        </div>

        <h2 className="mt-4 mb-2 text-lg">プロンプトを入力しよう！</h2>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            isPreviewPhase
              ? "記憶タイム中は入力できません。画像をよく覚えよう。"
              : "例: A playful neon cat eating salmon sushi..."
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
              ? "判定中..."
              : isPreviewPhase
                ? "記憶タイム終了待ち"
                : "画像を生成"}
          </Button>
          <Card className="bg-[var(--pmb-base)] px-3 py-2 text-center text-sm font-semibold shadow-[4px_4px_0_var(--pmb-ink)]">
            試行残り {attemptsLeft}
          </Card>
        </div>
        <p className="mt-2 text-xs font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_72%,white)]">
          {isPreviewPhase
            ? "プレビュー終了後に入力と送信が解放されます。"
            : "このラウンドで画像を生成できるのは1回だけです。"}
        </p>
        {feedback ? (
          <p className="mt-2 text-sm font-semibold text-[var(--pmb-red)]">{feedback}</p>
        ) : null}
        {!isRoundLive ? (
          <p className="mt-2 text-sm font-semibold">
            次ラウンド開始準備中です。お題生成が終わると送信できます。
          </p>
        ) : null}
      </Card>

      <section className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1fr_0.95fr]">
        <Card className="bg-white p-3">
          <h3 className="mb-2 text-base">お題画像</h3>
          {shouldShowTargetImage ? (
            round.targetImageUrl ? (
              <div className={imageFrameClass}>
                <img
                  src={round.targetImageUrl || placeholderImageUrl(round.gmTitle || "target")}
                  alt="target"
                  className="h-full w-full object-contain p-1"
                  onError={(event) =>
                    applyImageFallback(event.currentTarget, round.gmTitle || "target")
                  }
                />
              </div>
            ) : (
              <div
                className={`${imageFrameClass} flex items-center justify-center border-dashed bg-[var(--pmb-base)] p-4 text-center text-sm font-semibold`}
              >
                お題画像を同期中です...
              </div>
            )
          ) : (
            <div
              className={`${imageFrameClass} flex flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,var(--pmb-base),white)] p-6 text-center`}
            >
              <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4">
                <EyeOff className="h-8 w-8" />
              </div>
              <div>
                <p className="text-lg font-black">ここからは記憶だけで勝負</p>
                <p className="mt-2 text-sm font-semibold leading-relaxed">
                  画像はもう隠れました。思い出した要素を英語プロンプトに落とし込もう。
                </p>
              </div>
            </div>
          )}
        </Card>

        <Card className="bg-white p-3">
          <h3 className="mb-2 text-base">あなたの生成画像</h3>
          {latestAttempt ? (
            <div className="space-y-2">
              <div className={imageFrameClass}>
                <img
                  src={latestAttempt.imageUrl || placeholderImageUrl(latestAttempt.prompt)}
                  alt="latest attempt"
                  className="h-full w-full object-contain p-1"
                  onError={(event) =>
                    applyImageFallback(event.currentTarget, latestAttempt.prompt)
                  }
                />
                {latestAttemptScoring ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                    <p className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold">
                      <LoaderCircle className="h-4 w-4 animate-spin" /> 採点中...
                    </p>
                  </div>
                ) : null}
                {!latestAttemptScoring && typeof latestAttempt.score === "number" ? (
                  <p className="absolute right-2 top-2 rounded-md border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-1 font-mono text-sm font-black">
                    {latestAttempt.score} pts
                  </p>
                ) : null}
              </div>
              <Card className="h-28 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold">
                <p>判断根拠</p>
                {!latestAttemptScoring && latestAttempt.matchedElements?.length ? (
                  <p className="mt-1 text-[var(--pmb-green)]">
                    一致: {latestAttempt.matchedElements.join(" / ")}
                  </p>
                ) : null}
                {!latestAttemptScoring && latestAttempt.missingElements?.length ? (
                  <p className="mt-1 text-[var(--pmb-red)]">
                    不足: {latestAttempt.missingElements.join(" / ")}
                  </p>
                ) : null}
                {!latestAttemptScoring && latestAttempt.judgeNote ? (
                  <p className="mt-1">{latestAttempt.judgeNote}</p>
                ) : null}
                {latestAttemptScoring ? (
                  <p className="mt-1">採点完了後に根拠を表示します。</p>
                ) : null}
              </Card>
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className={`${imageFrameClass} flex items-center justify-center border-dashed bg-[var(--pmb-base)] p-4 text-sm font-semibold`}
              >
                まだ画像がありません。
              </div>
              <Card className="h-28 overflow-y-auto bg-[var(--pmb-base)] p-2 text-xs font-semibold">
                <p>判断根拠</p>
                <p className="mt-1">画像生成後に採点根拠を表示します。</p>
              </Card>
            </div>
          )}
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <Scoreboard entries={scores} myUid={user?.uid} />

          <Card className="min-h-0 bg-white p-3">
            <h3 className="mb-2 text-sm">みんなのベスト画像</h3>
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
                      src={entry.bestImageUrl || placeholderImageUrl(entry.displayName)}
                      alt={`${entry.displayName} best`}
                      className="aspect-square w-full rounded border-2 border-[var(--pmb-ink)] bg-white object-contain p-1"
                      onError={(event) =>
                        applyImageFallback(event.currentTarget, entry.displayName)
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold">他プレイヤーの投稿を待っています。</p>
            )}
          </Card>
        </div>
      </section>
    </main>
  );
}
