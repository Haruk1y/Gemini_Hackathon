"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { Lightbulb, LogOut, Send, Sparkles } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { useAuth } from "@/components/providers/auth-provider";
import { CountdownTimer } from "@/components/game/countdown-timer";
import { Scoreboard } from "@/components/game/scoreboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { placeholderImageUrl } from "@/lib/client/image";
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
import { clientDb } from "@/lib/firebase/client";
import { scoreBand } from "@/lib/scoring/cosine";
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
  gmTags: string[];
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
    score: number;
    prompt: string;
  }>;
}

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
  const [hintChecklist, setHintChecklist] = useState<string[]>([]);
  const [hintImageUrl, setHintImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const endCalled = useRef(false);

  const applyImageFallback = (element: HTMLImageElement, label: string) => {
    if (element.dataset.fallbackApplied === "true") return;
    element.dataset.fallbackApplied = "true";
    element.src = placeholderImageUrl(label);
  };

  useEffect(() => {
    if (!clientDb) {
      setError("Firebase設定が見つかりません。環境変数を確認してください。");
      return;
    }

    const roomUnsubscribe = onSnapshot(doc(clientDb, "rooms", roomId), (snapshot) => {
      if (!snapshot.exists()) return;
      setRoom(snapshot.data() as RoomData);
    });

    return roomUnsubscribe;
  }, [roomId]);

  useEffect(() => {
    if (!room?.currentRoundId) return;
    if (!clientDb) return;

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
      const sec = Math.ceil(ms / 1000);
      setSecondsLeft(sec);
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

  const submitPrompt = async () => {
    if (!round || !prompt.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<{
        ok: true;
        score: number;
        imageUrl: string;
      }>(
        "/api/rounds/submit",
        {
          roomId,
          roundId: round.roundId,
          prompt,
        },
        getIdToken,
      );

      setHintImageUrl(null);
      setHintChecklist([]);
      setPrompt("");
      setError(`スコア ${response.score} (${scoreBand(response.score)})`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("投稿に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const requestHint = async () => {
    if (!round) return;

    setBusy(true);
    setError(null);
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

      setHintChecklist(response.hint.deltaChecklist);
      setHintImageUrl(response.hintImageUrl);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("Hint取得に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const tags = useMemo(() => round?.gmTags ?? [], [round?.gmTags]);

  useRoomPresence({
    roomId,
    getIdToken,
    enabled: Boolean(room && user),
  });

  const onLeave = async () => {
    setBusy(true);
    setError(null);
    try {
      await leaveRoom({ roomId, getIdToken });
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

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">ラウンド準備中...</Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-8">
      <header className="flex flex-col items-start justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-white p-4 shadow-[8px_8px_0_var(--pmb-ink)] md:flex-row md:items-center">
        <div>
          <p className="text-xs font-bold uppercase">Round {round.index}</p>
          <h1 className="text-2xl">{round.gmTitle}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} className="bg-[var(--pmb-yellow)]">
                #{tag}
              </Badge>
            ))}
          </div>
        </div>
        <CountdownTimer secondsLeft={secondsLeft} />
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="bg-white">
          <h2 className="mb-3 text-lg">お題画像</h2>
          <img
            src={round.targetImageUrl || placeholderImageUrl(round.gmTitle || "target")}
            alt="target"
            className="aspect-square w-full rounded-lg border-4 border-[var(--pmb-ink)] object-cover"
            onError={(event) => applyImageFallback(event.currentTarget, round.gmTitle || "target")}
          />
          {!isRoundLive ? (
            <p className="mt-3 text-sm font-semibold">
              お題を生成中です。完了後にタイマーが開始されます。
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-semibold md:grid-cols-4">
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              試行残り {attemptsLeft}
            </Card>
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              Hint残り {hintsLeft}
            </Card>
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              投稿数 {round.stats.submissions}
            </Card>
            <Card className="bg-[var(--pmb-base)] p-2 text-center shadow-[4px_4px_0_var(--pmb-ink)]">
              Top {round.stats.topScore}
            </Card>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="bg-white">
            <h2 className="mb-2 text-lg">プロンプト入力</h2>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例: A playful neon cat eating salmon sushi..."
              maxLength={600}
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={submitPrompt}
                disabled={busy || !isRoundLive || attemptsLeft <= 0 || prompt.trim().length < 8}
              >
                <Send className="mr-1 h-4 w-4" /> 生成して送信
              </Button>
              <Button
                type="button"
                variant="accent"
                onClick={requestHint}
                disabled={busy || !isRoundLive || hintsLeft <= 0 || !attempts?.attempts.length}
              >
                <Lightbulb className="mr-1 h-4 w-4" /> Hint
              </Button>
            </div>
          </Card>

          <Card className="bg-white">
            <h3 className="mb-2 text-lg">最新結果</h3>
            {latestAttempt ? (
              <div className="space-y-2">
                <img
                  src={latestAttempt.imageUrl || placeholderImageUrl(latestAttempt.prompt)}
                  alt="latest attempt"
                  className="aspect-square w-full rounded-lg border-4 border-[var(--pmb-ink)] object-cover"
                  onError={(event) =>
                    applyImageFallback(event.currentTarget, latestAttempt.prompt)
                  }
                />
                <p className="font-mono text-lg font-black">
                  {latestAttempt.score} pts ({scoreBand(latestAttempt.score)})
                </p>
              </div>
            ) : (
              <p className="text-sm font-semibold">まだ投稿がありません。</p>
            )}
          </Card>

          {(hintChecklist.length > 0 || hintImageUrl) && (
            <Card className="bg-[var(--pmb-blue)]/25">
              <h3 className="mb-2 flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5" /> Hint
              </h3>
              <ul className="space-y-1 text-sm font-semibold">
                {hintChecklist.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
              {hintImageUrl && (
                <img
                  src={hintImageUrl || placeholderImageUrl("hint")}
                  alt="hint"
                  className="mt-3 aspect-square w-full rounded-lg border-4 border-[var(--pmb-ink)] object-cover"
                  onError={(event) => applyImageFallback(event.currentTarget, "hint")}
                />
              )}
            </Card>
          )}
        </div>
      </section>

      <Scoreboard entries={scores} myUid={user?.uid} />

      <section>
        <Button type="button" variant="ghost" onClick={onLeave} disabled={busy}>
          <LogOut className="mr-2 h-4 w-4" />
          ルームを退出
        </Button>
      </section>

      {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
    </main>
  );
}
