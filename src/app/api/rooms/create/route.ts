import { after } from "next/server";

import { createRoomSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { mergeRoomSettings } from "@/lib/game/defaults";
import { nextSeatOrder, syncCpuPlayers } from "@/lib/game/impostor";
import { assertModeCompatibleSettings } from "@/lib/game/room-service";
import { ensurePreparedRound } from "@/lib/game/round-service";
import {
  createRoomState,
  getRoomStateBackendInfo,
  roomStateExists,
  saveRoomState,
} from "@/lib/server/room-state";
import { createRoomCode } from "@/lib/utils/id";
import { dateAfterHours } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withPostHandler(createRoomSchema, async ({ body, auth }) => {
  const now = new Date();
  const expiresAt = dateAfterHours(24);
  const settings = mergeRoomSettings(body.settings);
  assertModeCompatibleSettings(settings);

  let roomId = "";
  for (let i = 0; i < 8; i += 1) {
    const candidate = createRoomCode();
    if (!(await roomStateExists(candidate))) {
      roomId = candidate;
      break;
    }
  }

  if (!roomId) {
    throw new Error("Failed to generate unique room code");
  }

  const state = createRoomState({
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

  state.players[auth.uid] = {
    uid: auth.uid,
    displayName: body.displayName,
    kind: "human",
    seatOrder: nextSeatOrder(state.players),
    isHost: true,
    joinedAt: now,
    expiresAt,
    lastSeenAt: now,
    ready: true,
    totalScore: 0,
  };
  syncCpuPlayers(state);

  await saveRoomState(state);
  const backend = getRoomStateBackendInfo();
  console.info("Room created", {
    roomId,
    uid: auth.uid,
    backend: backend.kind,
    envSource: backend.envSource ?? "memory",
  });
  after(async () => {
    try {
      await ensurePreparedRound({ roomId });
    } catch (error) {
      console.error("Deferred round preparation failed after room creation", error);
    }
  });
  return ok({ roomId, code: roomId });
});
