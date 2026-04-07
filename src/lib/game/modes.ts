import type { GameMode, RoomSettings } from "@/lib/types/game";
import { parseDate } from "@/lib/utils/time";

export const MEMORY_PREVIEW_SECONDS = 5;

interface GameModeDefinition {
  mode: GameMode;
  label: string;
  shortLabel: string;
  description: string;
  lobbyHint: string;
  roundBanner: string;
}

export const GAME_MODE_DEFINITIONS: Record<GameMode, GameModeDefinition> = {
  classic: {
    mode: "classic",
    label: "クラシック",
    shortLabel: "通常",
    description: "お題画像を見ながら、そのまま60秒でプロンプトを作る基本モード。",
    lobbyHint: "お題画像をずっと見ながら推理",
    roundBanner: "お題画像を見ながら、最も近い1枚を狙おう。",
  },
  memory: {
    mode: "memory",
    label: "記憶勝負",
    shortLabel: "記憶",
    description: "最初の5秒だけお題画像を見て、その後は記憶だけで60秒勝負するモード。",
    lobbyHint: "最初の5秒だけ見て、その後は記憶で勝負",
    roundBanner: "最初の5秒で目に焼き付けて、その後は記憶だけで再現しよう。",
  },
};

export const GAME_MODE_OPTIONS = Object.values(GAME_MODE_DEFINITIONS);

export function getGameModeDefinition(mode: GameMode): GameModeDefinition {
  return GAME_MODE_DEFINITIONS[mode];
}

export function summarizeRoomSettings(
  settings: Pick<
    RoomSettings,
    "gameMode" | "totalRounds" | "roundSeconds" | "maxAttempts" | "hintLimit"
  >,
): string {
  return [
    `${settings.totalRounds}ラウンド`,
    getGameModeDefinition(settings.gameMode).lobbyHint,
    `1ラウンド${settings.roundSeconds}秒`,
    `1人${settings.maxAttempts}回生成`,
    settings.hintLimit > 0 ? `ヒント${settings.hintLimit}回` : "ヒントなし",
  ].join(" / ");
}

export function getRoundSchedule(params: {
  gameMode: GameMode;
  roundSeconds: number;
  startedAt: Date;
}): {
  promptStartsAt: Date;
  endsAt: Date;
} {
  const previewSeconds = params.gameMode === "memory" ? MEMORY_PREVIEW_SECONDS : 0;
  const promptStartsAt = new Date(params.startedAt.getTime() + previewSeconds * 1000);
  const endsAt = new Date(promptStartsAt.getTime() + params.roundSeconds * 1000);

  return {
    promptStartsAt,
    endsAt,
  };
}

export function isMemoryPreviewActive(params: {
  gameMode: GameMode;
  promptStartsAt: unknown;
  now?: Date;
}): boolean {
  if (params.gameMode !== "memory") {
    return false;
  }

  const promptStartsAt = parseDate(params.promptStartsAt);
  if (!promptStartsAt) {
    return false;
  }

  return (params.now ?? new Date()).getTime() < promptStartsAt.getTime();
}
