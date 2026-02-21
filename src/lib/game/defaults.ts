import type { RoomSettings } from "@/lib/types/game";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  roundSeconds: 60,
  maxAttempts: 2,
  aspectRatio: "1:1",
  imageModel: "flash",
  hintLimit: 1,
  totalRounds: 3,
};

export function mergeRoomSettings(input?: Partial<RoomSettings>): RoomSettings {
  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...input,
    imageModel: "flash",
  };
}

export function nextRoundId(roundIndex: number): string {
  return `round-${roundIndex}`;
}
