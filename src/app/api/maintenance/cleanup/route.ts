import { NextResponse } from "next/server";

import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token === expected;
  }

  return false;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const expiredRooms = await getAdminDb()
    .collection("rooms")
    .where("expiresAt", "<=", now)
    .limit(50)
    .get();

  let deletedRooms = 0;

  for (const room of expiredRooms.docs) {
    const roomId = room.id;

    await getAdminDb().recursiveDelete(room.ref);
    await getAdminStorage()
      .bucket()
      .deleteFiles({ prefix: `rooms/${roomId}/` })
      .catch((error) => {
        console.warn("Storage cleanup warning", roomId, error);
      });

    deletedRooms += 1;
  }

  return NextResponse.json({
    ok: true,
    deletedRooms,
  });
}
