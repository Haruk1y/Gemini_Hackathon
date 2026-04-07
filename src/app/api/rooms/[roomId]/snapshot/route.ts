import { NextRequest, NextResponse } from "next/server";

import { verifySessionCookie } from "@/lib/auth/verify-session";
import {
  buildRoomViewSnapshot,
  type RoomViewName,
} from "@/lib/realtime/views";
import { loadRoomState } from "@/lib/server/room-state";
import { AppError, toErrorResponse } from "@/lib/utils/errors";

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
    const state = await loadRoomState(roomId);

    if (!state) {
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
