"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { useRoomPresence } from "@/lib/client/room-presence";
import { resolveUiErrorMessage, toUiError, type UiError } from "@/lib/i18n/errors";
import { type RoomData, useRoomSync } from "@/lib/client/room-sync";

export default function TransitionPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, copy } = useLanguage();
  const { user } = useAuth();
  const { snapshot } = useRoomSync({ roomId, view: "transition", enabled: Boolean(user) });
  const shouldStartNext = searchParams.get("start") === "1";

  const [startError, setStartError] = useState<UiError | null>(null);
  const startRequestedRef = useRef(false);
  const room = snapshot.room as RoomData | null;
  const isHost = user?.uid
    ? Boolean(snapshot.players.find((player) => player.uid === user.uid)?.isHost)
    : false;

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
    ).catch((error) => {
      console.error("rounds/next failed in transition", error);
      setStartError(toUiError(error, "startNextRoundFailed"));
      startRequestedRef.current = false;
    });
  }, [shouldStartNext, room, isHost, roomId]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user),
  });

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl bg-white text-center">
        <h1 className="text-2xl font-black md:text-3xl">{copy.transition.title}</h1>
        <p className="mt-2 text-sm font-semibold md:text-base">
          {copy.transition.description}
        </p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-4 py-2 text-sm font-bold md:text-base">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {copy.transition.loading}
        </p>
        {startError ? (
          <p className="mt-3 text-sm font-semibold text-[var(--pmb-red)]">
            {resolveUiErrorMessage(language, startError)}
          </p>
        ) : null}
      </Card>
    </main>
  );
}
