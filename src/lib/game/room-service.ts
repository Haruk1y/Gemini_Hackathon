import { getAdminDb } from "@/lib/firebase/admin";
import { playerRef, playersRef, roomRef } from "@/lib/api/paths";
import { requirePlayer, requireRoom } from "@/lib/game/guards";
import type { PlayerDoc } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

interface HostCandidate {
  uid: string;
  isHost: boolean;
  joinedAt?: Date;
}

export function selectNextHost(candidates: HostCandidate[]): string | null {
  if (!candidates.length) return null;

  const existingHost = candidates.find((candidate) => candidate.isHost);
  if (existingHost) return existingHost.uid;

  const sorted = [...candidates].sort((a, b) => {
    const at = a.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  return sorted[0]?.uid ?? null;
}

export function assertCanStartRound(players: Array<Pick<PlayerDoc, "ready">>): void {
  if (players.length < 2) {
    throw new AppError("VALIDATION_ERROR", "At least 2 players are required", false, 409);
  }

  const everyoneReady = players.every((player) => player.ready);
  if (!everyoneReady) {
    throw new AppError("VALIDATION_ERROR", "All players must be ready", false, 409);
  }
}

export async function pingRoom(roomId: string, uid: string): Promise<void> {
  const roomSnapshot = await roomRef(roomId).get();
  requireRoom(roomSnapshot);

  const playerSnapshot = await playerRef(roomId, uid).get();
  requirePlayer(playerSnapshot);

  await playerRef(roomId, uid).update({
    lastSeenAt: new Date(),
  });
}

export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  const roomSnapshot = await roomRef(roomId).get();
  requireRoom(roomSnapshot);

  const playerSnapshot = await playerRef(roomId, uid).get();
  const leavingPlayer = requirePlayer(playerSnapshot);

  await playerRef(roomId, uid).delete();

  const playersSnapshot = await playersRef(roomId).orderBy("joinedAt", "asc").get();

  if (playersSnapshot.empty) {
    await roomRef(roomId).update({
      status: "FINISHED",
      currentRoundId: null,
    });
    return;
  }

  if (!leavingPlayer.isHost) {
    return;
  }

  const candidates = playersSnapshot.docs.map((playerDoc) => {
    const data = playerDoc.data() as PlayerDoc;
    return {
      uid: data.uid,
      isHost: data.isHost,
      joinedAt: data.joinedAt,
    };
  });

  const nextHostUid = selectNextHost(candidates);
  if (!nextHostUid) return;

  const batch = getAdminDb().batch();
  for (const playerDoc of playersSnapshot.docs) {
    batch.update(playerDoc.ref, {
      isHost: playerDoc.id === nextHostUid,
    });
  }

  await batch.commit();
}
