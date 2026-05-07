import { nanoid } from "nanoid";

import { stampSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import { findStamp } from "@/lib/game/stamps";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
} from "@/lib/server/room-state";
import { AppError } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAMP_VISIBLE_MS = 4_000;
const STAMP_COOLDOWN_MS = 2_500;

export const POST = withPostHandler(stampSchema, async ({ body, auth }) => {
  const stamp = findStamp(body.stampId);
  if (!stamp) {
    throw new AppError("VALIDATION_ERROR", "Unknown stamp.", false, 400);
  }

  return withRoomLock(body.roomId, async () => {
    const state = await loadRoomState(body.roomId);
    const room = requireRoom(state?.room);
    const player = requirePlayer(state?.players[auth.uid]);

    if (room.status !== "IN_ROUND" && room.status !== "RESULTS") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Stamps can only be sent during a game.",
        false,
        409,
      );
    }

    const now = Date.now();
    const liveStamps = (state!.recentStamps ?? []).filter((event) => {
      const expiresAtMs = parseDate(event.expiresAt)?.getTime() ?? 0;
      return expiresAtMs > now;
    });
    const latestMine = liveStamps
      .filter((event) => event.uid === auth.uid)
      .sort(
        (a, b) =>
          (parseDate(b.createdAt)?.getTime() ?? 0) -
          (parseDate(a.createdAt)?.getTime() ?? 0),
      )[0];

    if (latestMine) {
      const latestMs = parseDate(latestMine.createdAt)?.getTime() ?? 0;
      if (now - latestMs < STAMP_COOLDOWN_MS) {
        throw new AppError(
          "RATE_LIMIT",
          "Stamp cooldown is still active.",
          false,
          429,
        );
      }
    }

    const event = {
      id: nanoid(10),
      uid: auth.uid,
      displayName: player.displayName,
      stampId: stamp.id,
      emoji: stamp.emoji,
      label: stamp.label,
      createdAt: new Date(now),
      expiresAt: new Date(now + STAMP_VISIBLE_MS),
    };

    state!.recentStamps = [...liveStamps, event].slice(-12);
    player.lastSeenAt = new Date(now);

    await saveRoomState(bumpRoomVersion(state!));

    return ok({ stamp: event });
  });
});
