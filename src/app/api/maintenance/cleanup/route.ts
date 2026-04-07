import { NextResponse } from "next/server";

import { deleteRoomState, listExpiredRoomIds } from "@/lib/server/room-state";
import { deleteStoragePrefix } from "@/lib/storage/upload-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handleCleanup() {
  const expiredRoomIds = await listExpiredRoomIds(50);
  let deletedRooms = 0;

  for (const roomId of expiredRoomIds) {
    await deleteRoomState(roomId);
    await deleteStoragePrefix(`rooms/${roomId}/`).catch((error) => {
      console.warn("Storage cleanup warning", roomId, error);
    });
    deletedRooms += 1;
  }

  return NextResponse.json({
    ok: true,
    deletedRooms,
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return handleCleanup();
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return handleCleanup();
}
