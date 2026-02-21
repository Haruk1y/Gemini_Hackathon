"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, LogOut, Play, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
import { clientDb } from "@/lib/firebase/client";

interface RoomData {
  roomId: string;
  code: string;
  status: "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
  currentRoundId: string | null;
}

interface PlayerData {
  uid: string;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  totalScore: number;
}

export default function LobbyPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { user, loading, getIdToken } = useAuth();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientDb) {
      setError("Firebase設定が見つかりません。環境変数を確認してください。");
      return;
    }

    const roomUnsubscribe = onSnapshot(doc(clientDb, "rooms", roomId), (snapshot) => {
      if (!snapshot.exists()) {
        setError("ルームが見つかりません");
        return;
      }
      setRoom(snapshot.data() as RoomData);
    });

    const playersQuery = query(
      collection(clientDb, "rooms", roomId, "players"),
      orderBy("joinedAt", "asc"),
    );

    const playersUnsubscribe = onSnapshot(playersQuery, (snapshot) => {
      setPlayers(snapshot.docs.map((item) => item.data() as PlayerData));
    });

    return () => {
      roomUnsubscribe();
      playersUnsubscribe();
    };
  }, [roomId]);

  useEffect(() => {
    if (!room) return;
    if (room.status === "IN_ROUND") {
      router.replace(`/round/${roomId}`);
    }
    if (room.status === "RESULTS") {
      router.replace(`/results/${roomId}`);
    }
    if (room.status === "FINISHED") {
      router.replace("/");
    }
  }, [room, roomId, router]);

  const me = useMemo(
    () => players.find((player) => player.uid === user?.uid) ?? null,
    [players, user?.uid],
  );

  const isGenerating = room?.status === "GENERATING_ROUND";
  const everyoneReady = players.length >= 2 && players.every((player) => player.ready);

  useRoomPresence({
    roomId,
    getIdToken,
    enabled: Boolean(room && user),
  });

  const onReadyToggle = async () => {
    if (!me) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost(
        "/api/rooms/ready",
        {
          roomId,
          ready: !me.ready,
        },
        getIdToken,
      );
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

  const onStart = async () => {
    if (!me?.isHost) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost(
        "/api/rounds/start",
        {
          roomId,
        },
        getIdToken,
      );
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
    await navigator.clipboard.writeText(room.code);
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

  if (loading || !room) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <Card className="bg-white">読み込み中...</Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-7 md:px-8">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="bg-[var(--pmb-yellow)] p-6">
          <p className="text-xs font-bold">ROOM CODE</p>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-mono text-4xl font-black tracking-widest">{room.code}</h1>
            <Button onClick={copyCode} type="button" variant="ghost">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-4 text-sm font-semibold">
            全員Readyで開始可能。ラウンドは60秒 x 2試行、全3ラウンドです。
          </p>
        </Card>

        <Card className="bg-white p-6">
          <h2 className="flex items-center gap-2 text-xl">
            <Users className="h-5 w-5" /> プレイヤー ({players.length})
          </h2>
          <div className="mt-3 space-y-2">
            {players.map((player) => (
              <div
                key={player.uid}
                className="flex items-center justify-between rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2"
              >
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {player.displayName}
                  {player.isHost && <Badge>HOST</Badge>}
                </p>
                <Badge className={player.ready ? "bg-[var(--pmb-green)]" : "bg-white"}>
                  {player.ready ? "READY" : "WAIT"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Button type="button" onClick={onReadyToggle} disabled={!me || busy || isGenerating}>
          {me?.ready ? "Ready解除" : "Readyにする"}
        </Button>

        <Button
          type="button"
          variant="accent"
          onClick={onStart}
          disabled={!me?.isHost || !everyoneReady || busy || isGenerating}
        >
          <Play className="mr-2 h-4 w-4" />
          {isGenerating ? "お題生成中..." : "ホストがラウンド開始"}
        </Button>
      </section>

      <section>
        <Button type="button" variant="ghost" onClick={onLeave} disabled={busy}>
          <LogOut className="mr-2 h-4 w-4" />
          ルームを退出
        </Button>
      </section>

      {isGenerating ? (
        <Card className="border-[var(--pmb-blue)] bg-white text-sm font-semibold">
          お題画像を生成中です。完了すると自動でラウンド画面へ遷移します。
        </Card>
      ) : everyoneReady ? (
        <Card className="border-[var(--pmb-green)] bg-white text-sm font-semibold">
          全員Readyです。ホストが開始できます。
        </Card>
      ) : (
        <Card className="bg-white text-sm font-semibold">2人以上かつ全員Readyで開始可能です。</Card>
      )}

      {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
    </main>
  );
}
