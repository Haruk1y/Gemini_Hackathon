export function buildRoundTargetImagePath(roomId: string, roundId: string): string {
  return `rooms/${roomId}/rounds/${roundId}/target.png`;
}

export function buildPlayerBestImagePath(
  roomId: string,
  roundId: string,
  uid: string,
): string {
  return `rooms/${roomId}/rounds/${roundId}/players/${uid}/best.png`;
}
