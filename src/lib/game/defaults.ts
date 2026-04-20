import {
  normalizeImageModel,
  type ImageModel,
  type RoomSettings,
} from "@/lib/types/game";

function resolveDefaultImageModel(): ImageModel {
  return normalizeImageModel(process.env.IMAGE_PROVIDER_DEFAULT, "gemini");
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  roundSeconds: 60,
  maxAttempts: 1,
  aspectRatio: "1:1",
  imageModel: resolveDefaultImageModel(),
  hintLimit: 0,
  totalRounds: 1,
  gameMode: "classic",
  cpuCount: 0,
};

export function mergeRoomSettings(input?: Partial<RoomSettings>): RoomSettings {
  const defaultImageModel = resolveDefaultImageModel();

  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...input,
    maxAttempts: DEFAULT_ROOM_SETTINGS.maxAttempts,
    imageModel: normalizeImageModel(input?.imageModel, defaultImageModel),
    hintLimit: DEFAULT_ROOM_SETTINGS.hintLimit,
  };
}

export function nextRoundId(roundIndex: number): string {
  return `round-${roundIndex}`;
}
