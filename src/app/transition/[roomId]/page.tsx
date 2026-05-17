"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { buildCurrentAppPath } from "@/lib/client/paths";
import { useRoomPresence } from "@/lib/client/room-presence";
import {
  resolveUiErrorMessage,
  toUiError,
  type UiError,
} from "@/lib/i18n/errors";
import { type RoomData, useRoomSync } from "@/lib/client/room-sync";

export default function TransitionPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, copy } = useLanguage();
  const { user } = useAuth();
  const { snapshot } = useRoomSync({
    roomId,
    view: "transition",
    enabled: Boolean(user),
  });
  const shouldStartNext = searchParams.get("start") === "1";

  const [startError, setStartError] = useState<UiError | null>(null);
  const [autoProceedSeconds, setAutoProceedSeconds] = useState(5);
  const startRequestedRef = useRef(false);
  const autoConfirmStartedRef = useRef(false);
  const room = snapshot.room as RoomData | null;
  const roleConfirmProgress = snapshot.roleConfirmProgress ?? null;
  const myRole = snapshot.myRole;
  const isImpostorMode = room?.settings?.gameMode === "impostor";
  const shouldGateOnRoleConfirm = Boolean(
    isImpostorMode &&
    room?.status === "IN_ROUND" &&
    room.currentRoundId &&
    roleConfirmProgress &&
    !roleConfirmProgress.allConfirmed,
  );
  const isHost = user?.uid
    ? Boolean(
        snapshot.players.find((player) => player.uid === user.uid)?.isHost,
      )
    : false;

  useEffect(() => {
    if (!room) return;
    if (room.status === "IN_ROUND" && !shouldGateOnRoleConfirm) {
      router.replace(buildCurrentAppPath(`/round/${roomId}`));
      return;
    }
    if (room.status === "LOBBY") {
      router.replace(buildCurrentAppPath(`/lobby/${roomId}`));
      return;
    }
    if (room.status === "FINISHED") {
      router.replace(buildCurrentAppPath("/"));
    }
  }, [room, roomId, router, shouldGateOnRoleConfirm]);

  useEffect(() => {
    autoConfirmStartedRef.current = false;
  }, [room?.currentRoundId, shouldGateOnRoleConfirm]);

  useEffect(() => {
    if (!shouldStartNext || !room || !isHost) return;
    if (room.status !== "RESULTS") return;
    if (startRequestedRef.current) return;

    startRequestedRef.current = true;

    void apiPost("/api/rounds/next", { roomId }).catch((error) => {
      console.error("rounds/next failed in transition", error);
      setStartError(toUiError(error, "startNextRoundFailed"));
      startRequestedRef.current = false;
    });
  }, [shouldStartNext, room, isHost, roomId]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user),
  });

  useEffect(() => {
    if (!shouldGateOnRoleConfirm || !room?.currentRoundId) return;

    const deadline = Date.now() + 5000;
    const tick = () => {
      setAutoProceedSeconds(
        Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      );
    };

    tick();
    const intervalId = window.setInterval(tick, 250);
    const timeoutId = window.setTimeout(() => {
      const proceed = async () => {
        if (
          !autoConfirmStartedRef.current &&
          !roleConfirmProgress?.meConfirmed
        ) {
          autoConfirmStartedRef.current = true;
          try {
            await apiPost("/api/rounds/confirm-role", {
              roomId,
              roundId: room.currentRoundId,
            });
          } catch (error) {
            console.error("auto confirm role failed", error);
          }
        }

        router.replace(buildCurrentAppPath(`/round/${roomId}`));
      };

      void proceed();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [
    roleConfirmProgress?.meConfirmed,
    room?.currentRoundId,
    roomId,
    router,
    shouldGateOnRoleConfirm,
  ]);

  if (shouldGateOnRoleConfirm && myRole) {
    return (
      <main className="page-enter mx-auto flex h-[100dvh] w-full items-center justify-center overflow-y-auto px-4 py-8">
        <Card className="w-full max-w-3xl bg-white text-center">
          <p className="text-xs font-black tracking-[0.2em] uppercase">
            {copy.transition.roleTitle}
          </p>
          <div
            className={[
              "mt-4 rounded-[24px] border-4 border-[var(--pmb-ink)] px-6 py-10 shadow-[8px_8px_0_var(--pmb-ink)] md:px-10 md:py-14",
              myRole === "impostor"
                ? "bg-[var(--pmb-red)] text-white"
                : "bg-[var(--pmb-green)] text-white",
            ].join(" ")}
          >
            <p className="text-4xl font-black tracking-[0.08em] uppercase md:text-7xl">
              {myRole === "impostor" ? copy.common.impostor : copy.common.agent}
            </p>
          </div>
          <p className="mt-4 text-sm font-semibold md:text-base">
            {copy.transition.autoProceedIn(autoProceedSeconds)}
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

  return (
    <main className="page-enter mx-auto flex h-[100dvh] w-full items-center justify-center overflow-y-auto px-4 py-8">
      <Card className="w-full max-w-xl bg-white text-center">
        <h1 className="text-2xl font-black md:text-3xl">
          {copy.transition.title}
        </h1>
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
