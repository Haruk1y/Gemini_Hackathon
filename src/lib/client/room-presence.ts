"use client";

import { useEffect } from "react";

import { apiPost } from "@/lib/client/api";

export function useRoomPresence(params: {
  roomId: string;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!params.enabled) return;

    let disposed = false;

    const sendPing = async () => {
      try {
        if (disposed) return;
        await apiPost(
          "/api/rooms/ping",
          {
            roomId: params.roomId,
          },
        );
      } catch (error) {
        if (!disposed) {
          console.warn("Room ping failed", error);
        }
      }
    };

    void sendPing();
    const timer = window.setInterval(() => {
      void sendPing();
    }, 20_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [params.enabled, params.roomId]);
}

export async function leaveRoom(params: {
  roomId: string;
}) {
  await apiPost(
    "/api/rooms/leave",
    {
      roomId: params.roomId,
    },
  );
}
