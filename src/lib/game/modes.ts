import type { Language } from "@/lib/i18n/language";
import type { GameMode, RoomSettings } from "@/lib/types/game";
import { parseDate } from "@/lib/utils/time";

export const MEMORY_PREVIEW_SECONDS = 10;
export const RESULTS_GRACE_SECONDS = 10;
export const CHANGE_WAIT_SECONDS = 5;
export const CHANGE_TRANSITION_SECONDS = 20;
export const CHANGE_ANSWER_SECONDS = 5;
export const CHANGE_RESET_SECONDS = 5;
export const CHANGE_DEFAULT_ROUND_SECONDS =
  CHANGE_WAIT_SECONDS + CHANGE_TRANSITION_SECONDS + CHANGE_ANSWER_SECONDS;
export function getChangeRoundSecondsForViewCount(viewCount: number) {
  const normalizedViewCount = Math.min(3, Math.max(1, Math.round(viewCount)));
  return (
    normalizedViewCount * CHANGE_DEFAULT_ROUND_SECONDS +
    Math.max(0, normalizedViewCount - 1) * CHANGE_RESET_SECONDS
  );
}

export function getChangeViewCountForRoundSeconds(roundSeconds: number) {
  const optionIndex = CHANGE_ROUND_SECONDS_OPTIONS.findIndex(
    (value) => value === roundSeconds,
  );
  if (optionIndex >= 0) return optionIndex + 1;

  const legacyViewCount = roundSeconds / CHANGE_DEFAULT_ROUND_SECONDS;
  if (
    Number.isInteger(legacyViewCount) &&
    legacyViewCount >= 1 &&
    legacyViewCount <= 3
  ) {
    return legacyViewCount;
  }

  return 1;
}

export const CHANGE_ROUND_SECONDS_OPTIONS = [
  getChangeRoundSecondsForViewCount(1),
  getChangeRoundSecondsForViewCount(2),
  getChangeRoundSecondsForViewCount(3),
] as const;
export const STANDARD_ROUND_SECONDS_OPTIONS = [30, 45, 60] as const;
const SECOND_MS = 1000;

interface LocalizedLabel {
  ja: string;
  en: string;
}

interface GameModeDefinitionSource {
  mode: GameMode;
  englishName: string;
  label: LocalizedLabel;
  shortLabel: LocalizedLabel;
  description: LocalizedLabel;
  lobbyHint: LocalizedLabel;
  /** Set to true to hide this mode from the UI and reject it at the API layer. */
  disabled?: boolean;
}

export interface GameModeDefinition {
  mode: GameMode;
  englishName: string;
  label: string;
  shortLabel: string;
  description: string;
  lobbyHint: string;
}

export const GAME_MODE_DEFINITIONS: Record<GameMode, GameModeDefinitionSource> =
  {
    classic: {
      mode: "classic",
      englishName: "Classic",
      label: { ja: "クラシック", en: "Classic" },
      shortLabel: { ja: "通常", en: "Classic" },
      description: {
        ja: "お題画像をみながらプロンプトを作る基本モード。",
        en: "The standard mode where you create prompts while looking at the target image.",
      },
      lobbyHint: {
        ja: "お題画像をずっと見ながら推理",
        en: "Infer while keeping the target image visible",
      },
    },
    memory: {
      mode: "memory",
      englishName: "Memory",
      label: { ja: "記憶勝負", en: "Memory Match" },
      shortLabel: { ja: "記憶", en: "Memory" },
      description: {
        ja: "お題画像を見れるのは最初の10秒だけ！記憶で勝負するモード。",
        en: "You can only see the target for the first 10 seconds. Win with memory alone.",
      },
      lobbyHint: {
        ja: "最初の10秒だけ見て、その後は記憶で勝負",
        en: "See it for 10 seconds, then rely on memory",
      },
    },
    change: {
      mode: "change",
      englishName: "Aha Moment",
      label: { ja: "アハ体験", en: "Aha Moment" },
      shortLabel: { ja: "アハ体験", en: "Aha" },
      description: {
        ja: "少しずつ変わる1か所を見つけて、誰よりも早くクリックするモード。",
        en: "Find the one changing spot as the image gradually shifts and click it before anyone else.",
      },
      lobbyHint: {
        ja: "徐々に変わる1か所を見抜いて早押し",
        en: "Watch the scene shift and click the changing spot first",
      },
    },
    impostor: {
      mode: "impostor",
      englishName: "Impostor",
      label: { ja: "Art Impostor", en: "Art Impostor" },
      shortLabel: { ja: "人狼", en: "Impostor" },
      description: {
        ja: "1人だけ人狼が紛れ込み、絵伝言の流れをこっそり壊すモード。",
        en: "One hidden impostor quietly tries to break the image relay while everyone else plays normally.",
      },
      lobbyHint: {
        ja: "順番に伝言して、人狼を投票で見抜く",
        en: "Relay the image and expose the impostor by voting",
      },
      disabled: true,
    },
  };

export function getGameModeOptions(language: Language): GameModeDefinition[] {
  return Object.values(GAME_MODE_DEFINITIONS)
    .filter((definition) => !definition.disabled)
    .map((definition) => getGameModeDefinition(definition.mode, language));
}

export function getGameModeDefinition(
  mode: GameMode,
  language: Language,
): GameModeDefinition {
  const definition = GAME_MODE_DEFINITIONS[mode];

  return {
    mode: definition.mode,
    englishName: definition.englishName,
    label: definition.label[language],
    shortLabel: definition.shortLabel[language],
    description: definition.description[language],
    lobbyHint: definition.lobbyHint[language],
  };
}

export function summarizeRoomSettings(
  settings: Pick<
    RoomSettings,
    "gameMode" | "totalRounds" | "roundSeconds" | "maxAttempts" | "hintLimit"
  >,
  language: Language,
): string {
  const labels =
    language === "ja"
      ? {
          rounds: `${settings.totalRounds}ラウンド`,
          roundSeconds: `1ラウンド${settings.roundSeconds}秒`,
          maxAttempts: `1人${settings.maxAttempts}回生成`,
          hint:
            settings.hintLimit > 0
              ? `ヒント${settings.hintLimit}回`
              : "ヒントなし",
        }
      : {
          rounds: `${settings.totalRounds} rounds`,
          roundSeconds: `${settings.roundSeconds}s per round`,
          maxAttempts: `${settings.maxAttempts} generations each`,
          hint:
            settings.hintLimit > 0 ? `${settings.hintLimit} hints` : "No hints",
        };

  return [
    labels.rounds,
    getGameModeDefinition(settings.gameMode, language).lobbyHint,
    labels.roundSeconds,
    labels.maxAttempts,
    labels.hint,
  ].join(" / ");
}

export function getRoundSubmissionDeadline(params: {
  promptStartsAt: unknown;
  roundSeconds: number;
}): Date | null {
  const promptStartsAt = parseDate(params.promptStartsAt);
  if (!promptStartsAt || !Number.isFinite(params.roundSeconds)) {
    return null;
  }

  return new Date(promptStartsAt.getTime() + params.roundSeconds * SECOND_MS);
}

export function isPostDeadlineGraceActive(params: {
  promptStartsAt: unknown;
  endsAt: unknown;
  roundSeconds: number;
  now?: Date;
}): boolean {
  const submissionDeadline = getRoundSubmissionDeadline(params);
  const endsAt = parseDate(params.endsAt);
  const now = params.now ?? new Date();

  if (!submissionDeadline || !endsAt) {
    return false;
  }

  return (
    now.getTime() >= submissionDeadline.getTime() &&
    now.getTime() < endsAt.getTime() &&
    endsAt.getTime() > submissionDeadline.getTime()
  );
}

export function getRoundSchedule(params: {
  gameMode: GameMode;
  roundSeconds: number;
  startedAt: Date;
}): {
  promptStartsAt: Date;
  endsAt: Date;
} {
  const previewSeconds =
    params.gameMode === "memory" ? MEMORY_PREVIEW_SECONDS : 0;
  const promptStartsAt = new Date(
    params.startedAt.getTime() + previewSeconds * SECOND_MS,
  );
  const endsAt = new Date(
    promptStartsAt.getTime() + params.roundSeconds * SECOND_MS,
  );

  return {
    promptStartsAt,
    endsAt,
  };
}

export function isRoundSecondsAllowedForMode(
  gameMode: GameMode,
  roundSeconds: number,
): boolean {
  const allowed =
    gameMode === "change"
      ? CHANGE_ROUND_SECONDS_OPTIONS
      : STANDARD_ROUND_SECONDS_OPTIONS;

  return allowed.some((value) => value === roundSeconds);
}

export function normalizeRoundSecondsForMode(
  gameMode: GameMode,
  roundSeconds: number | undefined,
): number {
  if (
    typeof roundSeconds === "number" &&
    isRoundSecondsAllowedForMode(gameMode, roundSeconds)
  ) {
    return roundSeconds;
  }

  return gameMode === "change"
    ? CHANGE_DEFAULT_ROUND_SECONDS
    : STANDARD_ROUND_SECONDS_OPTIONS[STANDARD_ROUND_SECONDS_OPTIONS.length - 1];
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
