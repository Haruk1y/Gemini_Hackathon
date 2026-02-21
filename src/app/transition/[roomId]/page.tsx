"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";

import { useAuth } from "@/components/providers/auth-provider";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { useRoomPresence } from "@/lib/client/room-presence";
import { clientDb } from "@/lib/firebase/client";

interface RoomData {
  status: "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
}

export default function TransitionPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, getIdToken } = useAuth();
  const shouldStartNext = searchParams.get("start") === "1";

  const [room, setRoom] = useState<RoomData | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startRequestedRef = useRef(false);

  useEffect(() => {
    if (!clientDb) return;

    const unsub = onSnapshot(doc(clientDb, "rooms", roomId), (snapshot) => {
      if (!snapshot.exists()) return;
      setRoom(snapshot.data() as RoomData);
    });

    return unsub;
  }, [roomId]);

  useEffect(() => {
    if (!clientDb || !user?.uid) return;

    const unsub = onSnapshot(doc(clientDb, "rooms", roomId, "players", user.uid), (snapshot) => {
      if (!snapshot.exists()) {
        setIsHost(false);
        return;
      }
      const data = snapshot.data() as { isHost?: boolean };
      setIsHost(Boolean(data.isHost));
    });

    return unsub;
  }, [roomId, user?.uid]);

  useEffect(() => {
    if (!room) return;
    if (room.status === "IN_ROUND") {
      router.replace(`/round/${roomId}`);
      return;
    }
    if (room.status === "LOBBY") {
      router.replace(`/lobby/${roomId}`);
      return;
    }
    if (room.status === "FINISHED") {
      router.replace("/");
    }
  }, [room, roomId, router]);

  useEffect(() => {
    if (!shouldStartNext || !room || !isHost) return;
    if (room.status !== "RESULTS") return;
    if (startRequestedRef.current) return;

    startRequestedRef.current = true;

    void apiPost(
      "/api/rounds/next",
      { roomId },
      getIdToken,
    ).catch((error) => {
      console.error("rounds/next failed in transition", error);
      setStartError("次ラウンド開始に失敗しました。もう一度お試しください。");
      startRequestedRef.current = false;
    });
  }, [shouldStartNext, room, isHost, roomId, getIdToken]);

  useRoomPresence({
    roomId,
    getIdToken,
    enabled: Boolean(room && user),
  });

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl bg-white text-center">
        <h1 className="text-2xl font-black md:text-3xl">次ラウンド開始中です。</h1>
        <p className="mt-2 text-sm font-semibold md:text-base">
          お題画像の準備が完了すると自動でラウンド画面へ移動します。
        </p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-4 py-2 text-sm font-bold md:text-base">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          しばらくお待ちください...
        </p>
        {startError ? <p className="mt-3 text-sm font-semibold text-[var(--pmb-red)]">{startError}</p> : null}
      </Card>
    </main>
  );
}
