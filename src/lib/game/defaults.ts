import {
  normalizeImageModel,
  normalizeTextModelVariant,
  type ImageModel,
  type RoomSettings,
  type TextModelVariant,
} from "@/lib/types/game";

export function resolveDefaultImageModel(): ImageModel {
  return normalizeImageModel(process.env.IMAGE_PROVIDER_DEFAULT, "flux");
}

function resolveLegacyTextModelDefault(): TextModelVariant {
  return normalizeTextModelVariant(process.env.GEMINI_TEXT_MODEL, "flash-lite");
}

export function resolveDefaultPromptModel(): TextModelVariant {
  return normalizeTextModelVariant(
    process.env.GEMINI_PROMPT_MODEL_DEFAULT,
    resolveLegacyTextModelDefault(),
  );
}

export function resolveDefaultJudgeModel(): TextModelVariant {
  return normalizeTextModelVariant(
    process.env.GEMINI_JUDGE_MODEL_DEFAULT,
    resolveLegacyTextModelDefault(),
  );
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

  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...input,
    maxAttempts: DEFAULT_ROOM_SETTINGS.maxAttempts,
    imageModel: normalizeImageModel(input?.imageModel, defaultImageModel),
    promptModel: normalizeTextModelVariant(input?.promptModel, defaultPromptModel),
    judgeModel: normalizeTextModelVariant(input?.judgeModel, defaultJudgeModel),
    hintLimit: DEFAULT_ROOM_SETTINGS.hintLimit,
  };
}

export function nextRoundId(roundSequence: number): string {
  return `round-${roundSequence}`;
}
