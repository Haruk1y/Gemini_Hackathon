import { createRoomSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { playerRef, roomRef } from "@/lib/api/paths";
import { mergeRoomSettings } from "@/lib/game/defaults";
import { createRoomCode } from "@/lib/utils/id";
import { dateAfterHours } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(createRoomSchema, async ({ body, auth }) => {
  const now = new Date();
  const expiresAt = dateAfterHours(24);
  const settings = mergeRoomSettings(body.settings);

  let roomId = "";
  for (let i = 0; i < 8; i += 1) {
    const candidate = createRoomCode();
    const existing = await roomRef(candidate).get();
    if (!existing.exists) {
      roomId = candidate;
      break;
    }
  }

  if (!roomId) {
    throw new Error("Failed to generate unique room code");
  }

  await roomRef(roomId).set({
    roomId,
    code: roomId,
    createdAt: now,
    expiresAt,
    createdByUid: auth.uid,
    status: "LOBBY",
    currentRoundId: null,
    roundIndex: 0,
    settings,
    ui: {
      theme: "neo-brutal",
    },
  });

  await playerRef(roomId, auth.uid).set({
    uid: auth.uid,
    displayName: body.displayName,
    isHost: true,
    joinedAt: now,
    expiresAt,
    lastSeenAt: now,
    ready: false,
    totalScore: 0,
  });

  return ok({ roomId, code: roomId });
});
