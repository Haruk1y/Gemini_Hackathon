import { joinRoomSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { requireRoom } from "@/lib/game/guards";
import { nextSeatOrder } from "@/lib/game/impostor";
import {
  bumpRoomVersion,
  loadRoomState,
  saveRoomState,
  withRoomLock,
} from "@/lib/server/room-state";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(joinRoomSchema, async ({ body, auth }) => {
  const roomId = body.code;

  await withRoomLock(roomId, async () => {
    const state = await loadRoomState(roomId);
    const room = requireRoom(state?.room);

    if (room.status !== "LOBBY") {
      throw new AppError("ROOM_NOT_JOINABLE", "Room is not in lobby state", false, 409);
    }

    if (Object.keys(state!.players).length >= room.settings.maxPlayers) {
      throw new AppError("ROOM_NOT_JOINABLE", "Room is already full", false, 409);
    }

    const now = new Date();
    const expiresAt = dateAfterHours(24);
    state!.players[auth.uid] = {
      uid: auth.uid,
      displayName: body.displayName,
      kind: "human",
      seatOrder: state!.players[auth.uid]?.seatOrder ?? nextSeatOrder(state!.players),
      isHost: state!.players[auth.uid]?.isHost ?? false,
      joinedAt: state!.players[auth.uid]?.joinedAt ?? now,
      expiresAt,
      lastSeenAt: now,
      ready: false,
      totalScore: 0,
    };

    await saveRoomState(bumpRoomVersion(state!));
  });

  return ok({ roomId });
});
