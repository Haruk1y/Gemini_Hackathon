"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flag, LoaderCircle, LogOut } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";

import { useAuth } from "@/components/providers/auth-provider";
import { Podium } from "@/components/game/podium";
import { ResultShareCard } from "@/components/game/result-share-card";
import { Scoreboard } from "@/components/game/scoreboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { useRoomPresence } from "@/lib/client/room-presence";
import { clientDb } from "@/lib/firebase/client";

interface RoomData {
  status: "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
  currentRoundId: string | null;
  roundIndex: number;
  settings: {
    totalRounds: number;
  };
}

interface RoundData {
  roundId: string;
  index: number;
  reveal?: {
    targetCaption?: string;
    gmPromptPublic?: string;
  };
}

interface ScoreEntry {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl: string;
}

interface PlayerData {
  uid: string;
  isHost: boolean;
}

function captionKeyLabel(key: string): string {
  switch (key) {
    case "scene":
      return "シーン";
    case "subjects":
      return "主題";
    case "objects":
      return "小物";
    case "colors":
      return "色";
    case "style":
      return "スタイル";
    case "composition":
      return "構図";
    case "text":
      return "画像内テキスト";
    default:
      return key;
  }
}

export default function ResultsPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();

  const { user, getIdToken } = useAuth();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [me, setMe] = useState<PlayerData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientDb) {
      setError("Firebase設定が見つかりません。環境変数を確認してください。");
      return;
    }

    const unsubRoom = onSnapshot(doc(clientDb, "rooms", roomId), (snapshot) => {
      if (!snapshot.exists()) return;
      setRoom(snapshot.data() as RoomData);
    });

    return unsubRoom;
  }, [roomId]);

  useEffect(() => {
    if (!room?.currentRoundId) return;
    if (!clientDb) return;

    const roundId = room.currentRoundId;

    const unsubRound = onSnapshot(
      doc(clientDb, "rooms", roomId, "rounds", roundId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        setRound(snapshot.data() as RoundData);
      },
    );

    const scoresQuery = query(
      collection(clientDb, "rooms", roomId, "rounds", roundId, "scores"),
      orderBy("bestScore", "desc"),
    );

    const unsubScores = onSnapshot(scoresQuery, (snapshot) => {
      setScores(snapshot.docs.map((item) => item.data() as ScoreEntry));
    });

    let unsubMe = () => {
      // noop
    };
    if (user?.uid) {
      unsubMe = onSnapshot(doc(clientDb, "rooms", roomId, "players", user.uid), (snapshot) => {
        if (!snapshot.exists()) return;
        setMe(snapshot.data() as PlayerData);
      });
    }

    return () => {
      unsubRound();
      unsubScores();
      unsubMe();
    };
  }, [room?.currentRoundId, roomId, user?.uid]);

  useEffect(() => {
    if (!room) return;
    if (room.status === "IN_ROUND") {
      router.replace(`/round/${roomId}`);
    }
    if (room.status === "LOBBY") {
      router.replace(`/lobby/${roomId}`);
    }
  }, [room, roomId, router]);

  useRoomPresence({
    roomId,
    getIdToken,
    enabled: Boolean(room && user),
  });

  const sortedScores = useMemo(
    () => [...scores].sort((a, b) => b.bestScore - a.bestScore),
    [scores],
  );
  const targetCaptionParts = useMemo(() => {
    const source = round?.reveal?.targetCaption?.trim();
    if (!source) return [];

    return source
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf(":");
        if (separator < 0) {
          return {
            key: "raw",
            label: "採点文字列",
            value: part,
          };
        }

        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim().replaceAll("|", " / ");
        return {
          key,
          label: captionKeyLabel(key),
          value,
        };
      });
  }, [round?.reveal?.targetCaption]);
  const winner = sortedScores[0] ?? null;

  const onNext = async () => {
    if (!me?.isHost || !room) return;

    setBusy(true);
    setError(null);

    try {
      await apiPost<{
        ok: true;
        finished: boolean;
        nextRoundId: string | null;
      }>(
        "/api/rounds/next",
        { roomId },
        getIdToken,
      );
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("次ラウンド開始に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const onLeave = () => {
    router.push(`/lobby/${roomId}`);
  };

  if (!room || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <Card className="bg-white">結果読み込み中...</Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4 shadow-[8px_8px_0_var(--pmb-ink)]">
        <div>
          <p className="text-xs font-bold uppercase">Round {round.index} Result</p>
          <h1 className="text-2xl">ランキング発表</h1>
        </div>
        {room.roundIndex >= room.settings.totalRounds ? (
          <Badge className="bg-[var(--pmb-red)] text-white">
            <Flag className="mr-1 h-3.5 w-3.5" /> FINAL ROUND
          </Badge>
        ) : (
          <Badge className="bg-[var(--pmb-green)]">NEXT ROUND READY</Badge>
        )}
      </header>

      <Podium entries={sortedScores} />

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Scoreboard entries={sortedScores} myUid={user?.uid} />

          <Card className="bg-white">
            <h2 className="text-lg">みんなの生成画像</h2>
            {sortedScores.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {sortedScores.map((entry) => (
                  <div
                    key={entry.uid}
                    className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-2"
                  >
                    <p className="mb-1 truncate text-xs font-bold">
                      {entry.displayName} ({entry.bestScore} pts)
                    </p>
                    <img
                      src={entry.bestImageUrl}
                      alt={`${entry.displayName} best`}
                      className="h-28 w-full rounded border-2 border-[var(--pmb-ink)] bg-white object-contain"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm font-semibold">まだ画像がありません。</p>
            )}
          </Card>

          {round.reveal?.targetCaption || round.reveal?.gmPromptPublic ? (
            <Card className="bg-white">
              <h2 className="text-lg">正解情報</h2>
              {round.reveal?.gmPromptPublic ? (
                <>
                  <p className="mt-3 text-xs font-bold">正解プロンプト（お題生成に使われた元プロンプト）</p>
                  <p className="mt-1 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3 font-mono text-xs">
                    {round.reveal.gmPromptPublic}
                  </p>
                </>
              ) : null}
              {targetCaptionParts.length > 0 ? (
                <>
                  <p className="mt-3 text-xs font-bold">採点用の画像説明（AIが生成した内部表現）</p>
                  <p className="mt-1 text-xs font-medium">
                    正解プロンプトの上に表示される文字列は、採点のために画像を要素分解した説明です。
                  </p>
                  <div className="mt-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-2">
                    <ul className="space-y-1 text-xs">
                      {targetCaptionParts.map((part, index) => (
                        <li key={`${part.key}-${index}`}>
                          <span className="font-bold">{part.label}:</span> {part.value || "-"}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {winner ? (
            <ResultShareCard
              roomId={roomId}
              winnerName={winner.displayName}
              winnerScore={winner.bestScore}
            />
          ) : null}

          <Card className="bg-white">
            <Button
              type="button"
              className="w-full"
              variant="accent"
              onClick={onNext}
              disabled={!me?.isHost || busy}
            >
              <ChevronRight className="mr-1 h-4 w-4" />
              {room.roundIndex >= room.settings.totalRounds
                ? "ロビーに戻る"
                : "次ラウンドへ"}
            </Button>
            {!me?.isHost ? (
              <p className="mt-2 text-xs font-semibold">次の進行はホストのみ実行できます。</p>
            ) : null}
            {room.status === "GENERATING_ROUND" || busy ? (
              <p className="mt-2 flex items-center gap-2 text-xs font-semibold">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                次ラウンド開始中...
              </p>
            ) : null}
          </Card>

          <Card className="bg-white">
            <Button type="button" variant="ghost" className="w-full" onClick={onLeave} disabled={busy}>
              <LogOut className="mr-2 h-4 w-4" />
              ロビーに戻る
            </Button>
          </Card>
        </div>
      </section>

      {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
    </main>
  );
}
