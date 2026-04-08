import type { RoomSettings } from "@/lib/types/game";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  roundSeconds: 60,
  maxAttempts: 1,
  aspectRatio: "1:1",
  imageModel: "flash",
  hintLimit: 0,
  totalRounds: 3,
  gameMode: "classic",
  cpuCount: 0,
};

export function mergeRoomSettings(input?: Partial<RoomSettings>): RoomSettings {
  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...input,
    maxAttempts: DEFAULT_ROOM_SETTINGS.maxAttempts,
    imageModel: "flash",
    hintLimit: DEFAULT_ROOM_SETTINGS.hintLimit,
  };
}

export function nextRoundId(roundIndex: number): string {
  return `round-${roundIndex}`;
}
