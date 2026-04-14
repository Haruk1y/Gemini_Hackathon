import { NextRequest, NextResponse } from "next/server";

import { verifySessionCookie } from "@/lib/auth/verify-session";
import { endRoundIfNeeded } from "@/lib/game/round-service";
import {
  buildRoomViewSnapshot,
  type RoomViewName,
} from "@/lib/realtime/views";
import { getRoomStateBackendInfo, loadRoomState } from "@/lib/server/room-state";
import { AppError, toErrorResponse } from "@/lib/utils/errors";
import { parseDate } from "@/lib/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseView(value: string | null): RoomViewName {
  if (
    value === "lobby" ||
    value === "round" ||
    value === "results" ||
    value === "transition"
  ) {
    return value;
  }

  throw new AppError("VALIDATION_ERROR", "Invalid room snapshot view", false, 400);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await params;
    const auth = verifySessionCookie(request.cookies);
    const view = parseView(request.nextUrl.searchParams.get("view"));
    const since = Number.parseInt(request.nextUrl.searchParams.get("since") ?? "", 10);
    const backend = getRoomStateBackendInfo();
    let state = await loadRoomState(roomId);

    if (state && view === "round" && state.room.status === "IN_ROUND" && state.room.currentRoundId) {
      const currentRound = state.rounds[state.room.currentRoundId];
      const endsAt = parseDate(currentRound?.endsAt);
      if (endsAt && Date.now() >= endsAt.getTime()) {
        await endRoundIfNeeded({
          roomId,
          roundId: state.room.currentRoundId,
        });
        state = await loadRoomState(roomId);
      }
    }

    if (!state) {
      console.warn("Room snapshot missing state", {
        roomId,
        uid: auth.uid,
        view,
        backend: backend.kind,
        envSource: backend.envSource ?? "memory",
      });
      return NextResponse.json({
        ok: true,
        version: 0,
        snapshot: {
          room: null,
          players: [],
          round: null,
          scores: [],
          attempts: null,
          playerCount: 0,
        },
      });
    }

    if (Number.isFinite(since) && since >= state.version) {
      return new NextResponse(null, { status: 204 });
    }

    if (!(auth.uid in state.players)) {
      console.warn("Room snapshot player missing", {
        roomId,
        uid: auth.uid,
        view,
        backend: backend.kind,
        envSource: backend.envSource ?? "memory",
        playerCount: Object.keys(state.players).length,
      });
    }

    const snapshot = buildRoomViewSnapshot({
      state,
      uid: auth.uid,
      view,
    });

    return NextResponse.json({
      ok: true,
      version: state.version,
      snapshot,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
