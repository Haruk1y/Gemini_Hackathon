import { getAdminDb } from "@/lib/google-cloud/admin";

export function roomRef(roomId: string) {
  return getAdminDb().collection("rooms").doc(roomId);
}

export function playersRef(roomId: string) {
  return roomRef(roomId).collection("players");
}

export function playerRef(roomId: string, uid: string) {
  return playersRef(roomId).doc(uid);
}

export function roundsRef(roomId: string) {
  return roomRef(roomId).collection("rounds");
}

export function roundRef(roomId: string, roundId: string) {
  return roundsRef(roomId).doc(roundId);
}

export function roundsPrivateRef(roomId: string) {
  return roomRef(roomId).collection("rounds_private");
}

export function roundPrivateRef(roomId: string, roundId: string) {
  return roundsPrivateRef(roomId).doc(roundId);
}

export function attemptsPrivateRef(roomId: string, roundId: string) {
  return roundRef(roomId, roundId).collection("attempts_private");
}

export function attemptPrivateRef(roomId: string, roundId: string, uid: string) {
  return attemptsPrivateRef(roomId, roundId).doc(uid);
}

export function scoresRef(roomId: string, roundId: string) {
  return roundRef(roomId, roundId).collection("scores");
}

export function scoreRef(roomId: string, roundId: string, uid: string) {
  return scoresRef(roomId, roundId).doc(uid);
}
