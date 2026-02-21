"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flag, LogOut } from "lucide-react";
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
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
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
  const winner = sortedScores[0] ?? null;

  const onNext = async () => {
    if (!me?.isHost || !room) return;

    setBusy(true);
    setError(null);

    try {
      const response = await apiPost<{
        ok: true;
        finished: boolean;
        nextRoundId: string | null;
      }>(
        "/api/rounds/next",
        { roomId },
        getIdToken,
      );

      if (response.finished) {
        setError("全ラウンド終了です。ホームに戻って新しいゲームを開始してください。");
      } else {
        router.push(`/round/${roomId}`);
      }
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

          {round.reveal?.targetCaption || round.reveal?.gmPromptPublic ? (
            <Card className="bg-white">
              <h2 className="text-lg">正解情報</h2>
              {round.reveal?.targetCaption ? (
                <p className="mt-2 text-sm font-medium">{round.reveal.targetCaption}</p>
              ) : null}
              {round.reveal?.gmPromptPublic ? (
                <p className="mt-3 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3 font-mono text-xs">
                  {round.reveal.gmPromptPublic}
                </p>
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
                ? "ゲームを終了"
                : "次ラウンドへ"}
            </Button>
            {!me?.isHost ? (
              <p className="mt-2 text-xs font-semibold">次の進行はホストのみ実行できます。</p>
            ) : null}
          </Card>

          <Card className="bg-white">
            <Button type="button" variant="ghost" className="w-full" onClick={onLeave} disabled={busy}>
              <LogOut className="mr-2 h-4 w-4" />
              ルームを退出
            </Button>
          </Card>
        </div>
      </section>

      {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
    </main>
  );
}
