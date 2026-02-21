"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";

import { useAuth } from "@/components/providers/auth-provider";
import { Card } from "@/components/ui/card";
import { useRoomPresence } from "@/lib/client/room-presence";
import { clientDb } from "@/lib/firebase/client";

interface RoomData {
  status: "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
}

export default function TransitionPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { user, getIdToken } = useAuth();

  const [room, setRoom] = useState<RoomData | null>(null);

  useEffect(() => {
    if (!clientDb) return;

    const unsub = onSnapshot(doc(clientDb, "rooms", roomId), (snapshot) => {
      if (!snapshot.exists()) return;
      setRoom(snapshot.data() as RoomData);
    });

    return unsub;
  }, [roomId]);

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

  useRoomPresence({
    roomId,
    getIdToken,
    enabled: Boolean(room && user),
  });

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl bg-white text-center">
        <p className="text-xs font-black uppercase tracking-wide">Transition</p>
        <h1 className="mt-1 text-3xl font-black md:text-4xl">次ラウンドへ遷移中</h1>
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-4 py-2 text-sm font-bold">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          しばらくお待ちください...
        </p>
      </Card>
    </main>
  );
}
