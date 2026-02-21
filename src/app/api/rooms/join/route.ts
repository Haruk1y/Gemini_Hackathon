import { joinRoomSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { playerRef, playersRef, roomRef } from "@/lib/api/paths";
import { requireRoom } from "@/lib/game/guards";
import { AppError } from "@/lib/utils/errors";
import { dateAfterHours } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(joinRoomSchema, async ({ body, auth }) => {
  const roomSnapshot = await roomRef(body.code).get();
  const room = requireRoom(roomSnapshot);

  if (room.status !== "LOBBY") {
    throw new AppError("ROOM_NOT_JOINABLE", "Room is not in lobby state", false, 409);
  }

  const currentPlayers = await playersRef(room.roomId).get();
  if (currentPlayers.size >= room.settings.maxPlayers) {
    throw new AppError("ROOM_NOT_JOINABLE", "Room is already full", false, 409);
  }

  const now = new Date();
  const expiresAt = dateAfterHours(24);
  await playerRef(room.roomId, auth.uid).set(
    {
      uid: auth.uid,
      displayName: body.displayName,
      isHost: false,
      joinedAt: now,
      expiresAt,
      lastSeenAt: now,
      ready: false,
      totalScore: 0,
    },
    { merge: true },
  );

  return ok({ roomId: room.roomId });
});
