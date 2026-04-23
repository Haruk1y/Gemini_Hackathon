import {
  normalizeImageModel,
  normalizeTextModelVariant,
  type ImageModel,
  type RoomSettings,
  type TextModelVariant,
} from "@/lib/types/game";
import { normalizeRoundSecondsForMode } from "@/lib/game/modes";

export function resolveDefaultImageModel(): ImageModel {
  return normalizeImageModel(process.env.IMAGE_PROVIDER_DEFAULT, "flux");
}

export function resolveDefaultPromptModel(): TextModelVariant {
  return normalizeTextModelVariant(process.env.GEMINI_PROMPT_MODEL_DEFAULT, "flash-lite");
}

export function resolveDefaultJudgeModel(): TextModelVariant {
  return normalizeTextModelVariant(process.env.GEMINI_JUDGE_MODEL_DEFAULT, "flash-lite");
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  roundSeconds: 60,
  maxAttempts: 1,
  aspectRatio: "1:1",
  imageModel: resolveDefaultImageModel(),
  promptModel: resolveDefaultPromptModel(),
  judgeModel: resolveDefaultJudgeModel(),
  hintLimit: 0,
  totalRounds: 1,
  gameMode: "classic",
  cpuCount: 0,
};

export function mergeRoomSettings(input?: Partial<RoomSettings>): RoomSettings {
  const defaultImageModel = resolveDefaultImageModel();
  const defaultPromptModel = resolveDefaultPromptModel();
  const defaultJudgeModel = resolveDefaultJudgeModel();
  const gameMode = input?.gameMode ?? DEFAULT_ROOM_SETTINGS.gameMode;

  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...input,
    maxAttempts: DEFAULT_ROOM_SETTINGS.maxAttempts,
    roundSeconds: normalizeRoundSecondsForMode(gameMode, input?.roundSeconds),
    imageModel: normalizeImageModel(input?.imageModel, defaultImageModel),
    promptModel: normalizeTextModelVariant(input?.promptModel, defaultPromptModel),
    judgeModel: normalizeTextModelVariant(input?.judgeModel, defaultJudgeModel),
    hintLimit: DEFAULT_ROOM_SETTINGS.hintLimit,
    gameMode,
    cpuCount: gameMode === "change" ? 0 : input?.cpuCount ?? DEFAULT_ROOM_SETTINGS.cpuCount,
  };
}

export function nextRoundId(roundSequence: number): string {
  return `round-${roundSequence}`;
}
