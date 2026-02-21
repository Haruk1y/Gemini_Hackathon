"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { Lightbulb, LoaderCircle, LogOut, Send } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";

import { useAuth } from "@/components/providers/auth-provider";
import { CountdownTimer } from "@/components/game/countdown-timer";
import { Scoreboard } from "@/components/game/scoreboard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { placeholderImageUrl } from "@/lib/client/image";
import { useRoomPresence } from "@/lib/client/room-presence";
import { clientDb } from "@/lib/firebase/client";
import { millisecondsLeft } from "@/lib/utils/time";

interface RoomData {
  status: "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
  currentRoundId: string | null;
  settings: {
    roundSeconds: number;
    maxAttempts: number;
    hintLimit: number;
  };
}

interface RoundData {
  roundId: string;
  index: number;
  status: "GENERATING" | "IN_ROUND" | "RESULTS";
  targetImageUrl: string;
  gmTitle: string;
  reveal?: {
    gmPromptPublic?: string;
  };
  endsAt: unknown;
  stats: {
    submissions: number;
    topScore: number;
  };
}

interface ScoreEntry {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl: string;
}

interface AttemptData {
  attemptsUsed: number;
  hintUsed: number;
  bestScore: number;
  attempts: Array<{
    attemptNo: number;
    imageUrl: string;
    score: number | null;
    prompt: string;
    status?: "SCORING" | "DONE";
  }>;
}

type SubmitResponse = Record<string, unknown> & {
  ok: true;
  score: number;
  imageUrl: string;
  scoreSource?: "visual" | "semantic";
};

export default function RoundPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();

  const { user, getIdToken } = useAuth();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [attempts, setAttempts] = useState<AttemptData | null>(null);
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("success");
  const [submitPending, setSubmitPending] = useState(false);
  const [hintPending, setHintPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const endCalled = useRef(false);

  const applyImageFallback = (element: HTMLImageElement, label: string) => {
    if (element.dataset.fallbackApplied === "true") return;
    element.dataset.fallbackApplied = "true";
    element.src = placeholderImageUrl(label);
  };

  useEffect(() => {
    if (!clientDb) {
      setFeedback("Firebase設定が見つかりません。環境変数を確認してください。");
      setFeedbackType("error");
      return;
    }

    const roomUnsubscribe = onSnapshot(doc(clientDb, "rooms", roomId), (snapshot) => {
      if (!snapshot.exists()) return;
      setRoom(snapshot.data() as RoomData);
    });

    return roomUnsubscribe;
  }, [roomId]);

  useEffect(() => {
    if (!room?.currentRoundId || !clientDb) return;

    const currentRoundId = room.currentRoundId;

    const roundUnsubscribe = onSnapshot(
      doc(clientDb, "rooms", roomId, "rounds", currentRoundId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        setRound(snapshot.data() as RoundData);
      },
    );

    const scoresQuery = query(
      collection(clientDb, "rooms", roomId, "rounds", currentRoundId, "scores"),
      orderBy("bestScore", "desc"),
    );

    const scoresUnsubscribe = onSnapshot(scoresQuery, (snapshot) => {
      setScores(snapshot.docs.map((entry) => entry.data() as ScoreEntry));
    });

    let attemptsUnsubscribe = () => {
      // noop
    };

    if (user?.uid) {
      attemptsUnsubscribe = onSnapshot(
        doc(clientDb, "rooms", roomId, "rounds", currentRoundId, "attempts_private", user.uid),
        (snapshot) => {
          if (!snapshot.exists()) {
            setAttempts(null);
            return;
          }
          setAttempts(snapshot.data() as AttemptData);
        },
      );
    }

    return () => {
      roundUnsubscribe();
      scoresUnsubscribe();
      attemptsUnsubscribe();
    };
  }, [room?.currentRoundId, roomId, user?.uid]);

  useEffect(() => {
    if (!round || !room) {
      setSecondsLeft(0);
      return;
    }

    if (room.status !== "IN_ROUND" || round.status !== "IN_ROUND" || !round.endsAt) {
      setSecondsLeft(room.settings.roundSeconds);
      return;
    }

    const update = () => {
      const ms = millisecondsLeft(round.endsAt);
      setSecondsLeft(Math.ceil(ms / 1000));
    };

    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [round, room]);

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
    void apiPost(
      "/api/rounds/endIfNeeded",
      {
        roomId,
        roundId: round.roundId,
      },
      getIdToken,
    ).catch((err) => {
      console.error("endIfNeeded failed", err);
      endCalled.current = false;
    });
  }, [secondsLeft, room, round, roomId, router, getIdToken]);

  const latestAttempt = attempts?.attempts?.[attempts.attempts.length - 1] ?? null;
  const attemptsLeft = Math.max(0, (room?.settings.maxAttempts ?? 0) - (attempts?.attemptsUsed ?? 0));
  const hintsLeft = Math.max(0, (room?.settings.hintLimit ?? 0) - (attempts?.hintUsed ?? 0));
  const isRoundLive = room?.status === "IN_ROUND" && round?.status === "IN_ROUND";
  const isBusy = submitPending || hintPending;
  const otherBestImages = scores.filter((entry) => entry.uid !== user?.uid && entry.bestImageUrl);
  const latestAttemptScoring = Boolean(latestAttempt && (latestAttempt.status === "SCORING" || latestAttempt.score == null));

  useRoomPresence({
    roomId,
    getIdToken,
    enabled: Boolean(room && user),
  });

  const submitPrompt = async () => {
    if (!round || !prompt.trim()) return;

    setSubmitPending(true);
    setFeedback(null);

    try {
      const response = await apiPost<SubmitResponse>(
        "/api/rounds/submit",
        {
          roomId,
          roundId: round.roundId,
          prompt,
        },
        getIdToken,
      );

      setPrompt("");
      setFeedback(`スコア ${response.score} pts`);
      setFeedbackType("success");
    } catch (e) {
      if (e instanceof ApiClientError) {
        setFeedback(e.message);
      } else {
        setFeedback("投稿に失敗しました");
      }
      setFeedbackType("error");
    } finally {
      setSubmitPending(false);
    }
  };

  const requestHint = async () => {
    if (!round) return;

    setHintPending(true);
    setFeedback(null);

    try {
      const response = await apiPost<{
        ok: true;
        hint: { deltaChecklist: string[]; improvedPrompt: string };
        hintImageUrl: string;
      }>(
        "/api/rounds/hint",
        {
          roomId,
          roundId: round.roundId,
        },
        getIdToken,
      );

      const firstTip = response.hint.deltaChecklist[0];
      setFeedback(firstTip ? `ヒント: ${firstTip}` : "ヒントを更新しました");
      setFeedbackType("success");
    } catch (e) {
      if (e instanceof ApiClientError) {
        setFeedback(e.message);
      } else {
        setFeedback("Hint取得に失敗しました");
      }
      setFeedbackType("error");
    } finally {
      setHintPending(false);
    }
  };

  const onBackToLobby = () => {
    router.push(`/lobby/${roomId}`);
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
            <p className="text-xs font-bold uppercase">Round {round.index}</p>
            <h1 className="text-xl">プロンプトを入力して送信</h1>
          </div>
          <div className="flex items-center gap-2">
            <CountdownTimer secondsLeft={secondsLeft} />
            <Button type="button" variant="ghost" onClick={onBackToLobby} disabled={isBusy}>
              <LogOut className="mr-2 h-4 w-4" />
              ルームを退出
            </Button>
          </div>
        </div>

        <h2 className="mt-3 mb-2 text-lg">プロンプト入力</h2>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例: A playful neon cat eating salmon sushi..."
          maxLength={600}
          className="min-h-20"
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[auto_auto_1fr]">
          <Button
            type="button"
            onClick={submitPrompt}
            disabled={isBusy || !isRoundLive || attemptsLeft <= 0 || prompt.trim().length < 8}
          >
            {submitPending ? (
              <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {submitPending ? "判定中..." : "生成して送信"}
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={requestHint}
            disabled={isBusy || !isRoundLive || hintsLeft <= 0 || !attempts?.attempts.length}
          >
            {hintPending ? (
              <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Lightbulb className="mr-1 h-4 w-4" />
            )}
            {hintPending ? "ヒント生成中..." : "Hint"}
          </Button>
          <div className="grid grid-cols-2 gap-2 text-sm font-semibold lg:grid-cols-3">
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              試行残り {attemptsLeft}
            </Card>
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              Hint残り {hintsLeft}
            </Card>
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              投稿数 {round.stats.submissions}
            </Card>
          </div>
        </div>
        {feedback ? (
          <p
            className={[
              "mt-2 text-sm font-semibold",
              feedbackType === "error" ? "text-[var(--pmb-red)]" : "text-[var(--pmb-green)]",
            ].join(" ")}
          >
            {feedback}
          </p>
        ) : null}
      </Card>

      <section className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1fr_0.95fr]">
        <Card className="bg-white p-3 lg:flex lg:min-h-0 lg:flex-col">
          <h3 className="mb-2 text-base">お題画像</h3>
          <div className="lg:min-h-0 lg:flex-1">
            <img
              src={round.targetImageUrl || placeholderImageUrl(round.gmTitle || "target")}
              alt="target"
              className="aspect-square h-full w-full rounded-lg border-4 border-[var(--pmb-ink)] object-cover lg:aspect-auto"
              onError={(event) => applyImageFallback(event.currentTarget, round.gmTitle || "target")}
            />
          </div>
        </Card>

        <Card className="bg-white p-3 lg:flex lg:min-h-0 lg:flex-col">
          <h3 className="mb-2 text-base">あなたの生成画像</h3>
          {latestAttempt ? (
            <div className="space-y-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <div className="relative lg:min-h-0 lg:flex-1">
                <img
                  src={latestAttempt.imageUrl || placeholderImageUrl(latestAttempt.prompt)}
                  alt="latest attempt"
                  className="aspect-square h-full w-full rounded-lg border-4 border-[var(--pmb-ink)] object-cover lg:aspect-auto"
                  onError={(event) => applyImageFallback(event.currentTarget, latestAttempt.prompt)}
                />
                {latestAttemptScoring ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                    <p className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold">
                      <LoaderCircle className="h-4 w-4 animate-spin" /> 採点中...
                    </p>
                  </div>
                ) : null}
              </div>
              {!latestAttemptScoring && typeof latestAttempt.score === "number" ? (
                <p className="font-mono text-base font-black">
                  {latestAttempt.score} pts
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-lg border-4 border-dashed border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-4 text-sm font-semibold lg:h-full lg:aspect-auto">
              まだ投稿がありません。
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
                      className="h-28 w-full rounded border-2 border-[var(--pmb-ink)] bg-white object-contain"
                      onError={(event) => applyImageFallback(event.currentTarget, entry.displayName)}
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
