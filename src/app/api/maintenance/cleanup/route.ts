import { NextResponse } from "next/server";

import { verifySchedulerRequest } from "@/lib/auth/verify-scheduler";
import {
  getAdminDb,
  getAdminStorage,
  getStorageBucketName,
} from "@/lib/google-cloud/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await verifySchedulerRequest(request);
  } catch {
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
      .bucket(getStorageBucketName())
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
