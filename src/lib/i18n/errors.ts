import { ApiClientError } from "@/lib/client/api";
import { type Language } from "@/lib/i18n/language";
import type { ErrorCode } from "@/lib/types/game";

export type LocalErrorKey =
  | "sessionInitializationFailed"
  | "createRoomFailed"
  | "joinRoomFailed"
  | "updateRulesFailed"
  | "readyUpdateFailed"
  | "startRoundFailed"
  | "leaveRoomFailed"
  | "shufflePlayersFailed"
  | "submitPromptFailed"
  | "voteFailed"
  | "startNextRoundFailed";

export type UiError =
  | {
      kind: "api";
      code: ErrorCode;
      message?: string | null;
    }
  | {
      kind: "local";
      key: LocalErrorKey;
    };

type ApiMessageKey =
  | "roomNotInLobby"
  | "roomAlreadyFull"
  | "onlyHost"
  | "onlyHostNextRound"
  | "readyOnlyInLobby"
  | "settingsOnlyInLobby"
  | "shuffleOnlyInLobby"
  | "allPlayersReady"
  | "noAttemptsLeft"
  | "promptNotStarted"
  | "roundInactive"
  | "roundAlreadyEnded"
  | "voteSelf"
  | "voteCpu"
  | "voteClosed"
  | "votesLocked"
  | "roomMissing"
  | "playerMissing"
  | "roundMissing"
  | "turnMismatch"
  | "gcpExpired"
  | "rateLimited";

const LOCAL_ERROR_MESSAGES: Record<Language, Record<LocalErrorKey, string>> = {
  ja: {
    sessionInitializationFailed: "セッション初期化に失敗しました",
    createRoomFailed: "ルーム作成に失敗しました",
    joinRoomFailed: "ルーム参加に失敗しました",
    updateRulesFailed: "ルール更新に失敗しました",
    readyUpdateFailed: "READY 更新に失敗しました",
    startRoundFailed: "ラウンド開始に失敗しました",
    leaveRoomFailed: "退出に失敗しました",
    shufflePlayersFailed: "並び順のシャッフルに失敗しました",
    submitPromptFailed: "投稿に失敗しました",
    voteFailed: "投票に失敗しました。",
    startNextRoundFailed: "次ラウンド開始に失敗しました。もう一度お試しください。",
  },
  en: {
    sessionInitializationFailed: "Failed to initialize the session.",
    createRoomFailed: "Failed to create the room.",
    joinRoomFailed: "Failed to join the room.",
    updateRulesFailed: "Failed to update the rules.",
    readyUpdateFailed: "Failed to update READY.",
    startRoundFailed: "Failed to start the round.",
    leaveRoomFailed: "Failed to leave the room.",
    shufflePlayersFailed: "Failed to shuffle the player order.",
    submitPromptFailed: "Failed to submit the prompt.",
    voteFailed: "Failed to submit the vote.",
    startNextRoundFailed: "Failed to start the next round. Please try again.",
  },
};

const API_CODE_MESSAGES: Record<Language, Record<ErrorCode, string>> = {
  ja: {
    UNAUTHORIZED: "セッションが無効です。ページを再読み込みしてください。",
    VALIDATION_ERROR: "入力内容を確認して、もう一度お試しください。",
    ROOM_NOT_FOUND: "ルームが見つかりません。",
    ROUND_NOT_FOUND: "ラウンド情報が見つかりません。",
    PLAYER_NOT_FOUND: "プレイヤー情報が見つかりません。",
    NOT_HOST: "この操作はホストのみ実行できます。",
    ROOM_NOT_JOINABLE: "このルームには参加できません。",
    ROUND_CLOSED: "このラウンドは現在操作できません。",
    MAX_ATTEMPTS_REACHED: "これ以上は生成できません。",
    HINT_LIMIT_REACHED: "これ以上ヒントは使えません。",
    RATE_LIMIT: "処理が混み合っています。少し待ってから再試行してください。",
    GEMINI_ERROR: "画像生成に失敗しました。少し待ってから再試行してください。",
    GCP_ERROR: "Google Cloud 認証の更新が必要です。",
    INTERNAL_ERROR: "サーバーエラーが発生しました。しばらくしてから再試行してください。",
  },
  en: {
    UNAUTHORIZED: "Your session is invalid. Please reload the page.",
    VALIDATION_ERROR: "Please review the input and try again.",
    ROOM_NOT_FOUND: "The room could not be found.",
    ROUND_NOT_FOUND: "The round could not be found.",
    PLAYER_NOT_FOUND: "The player could not be found.",
    NOT_HOST: "Only the host can perform this action.",
    ROOM_NOT_JOINABLE: "This room is not joinable.",
    ROUND_CLOSED: "This round is not available right now.",
    MAX_ATTEMPTS_REACHED: "You have no attempts left.",
    HINT_LIMIT_REACHED: "You have no hints left.",
    RATE_LIMIT: "The server is busy right now. Please try again in a moment.",
    GEMINI_ERROR: "Image generation failed. Please try again in a moment.",
    GCP_ERROR: "Google Cloud authentication needs to be refreshed.",
    INTERNAL_ERROR: "A server error occurred. Please try again shortly.",
  },
};

const API_MESSAGE_MAP: Record<string, ApiMessageKey> = {
  "Room is not in lobby state": "roomNotInLobby",
  "Room is already full": "roomAlreadyFull",
  "Only host can perform this action": "onlyHost",
  "Only host can start next round": "onlyHostNextRound",
  "READY状態を変更できるのはロビー中だけです。": "readyOnlyInLobby",
  "ルーム設定を変更できるのはロビー中だけです。": "settingsOnlyInLobby",
  "プレイヤー順をシャッフルできるのはロビー中だけです。": "shuffleOnlyInLobby",
  "All players must be ready": "allPlayersReady",
  "No attempts left": "noAttemptsLeft",
  "まだプロンプト入力開始前です。": "promptNotStarted",
  "Round is not active": "roundInactive",
  "This round is not active": "roundInactive",
  "Round already ended": "roundAlreadyEnded",
  "自分自身には投票できません。": "voteSelf",
  "CPU players cannot vote via API": "voteCpu",
  "Result voting is not active": "voteClosed",
  "Votes are already locked": "votesLocked",
  "Room does not exist": "roomMissing",
  "Player does not exist": "playerMissing",
  "Round does not exist": "roundMissing",
  "Round private data missing": "roundMissing",
  "It is not your turn": "turnMismatch",
  "Turn already ended": "turnMismatch",
  "Google Cloud 認証の期限が切れています。`gcloud auth application-default login` を実行してから再試行してください。": "gcpExpired",
  "処理が混み合っています。少し待ってから再試行してください。": "rateLimited",
};

const API_MESSAGE_MESSAGES: Record<Language, Record<ApiMessageKey, string>> = {
  ja: {
    roomNotInLobby: "このルームは現在ロビーではありません。",
    roomAlreadyFull: "このルームは満員です。",
    onlyHost: "この操作はホストのみ実行できます。",
    onlyHostNextRound: "次ラウンドへ進められるのはホストのみです。",
    readyOnlyInLobby: "READY を変更できるのはロビー中だけです。",
    settingsOnlyInLobby: "ルーム設定を変更できるのはロビー中だけです。",
    shuffleOnlyInLobby: "並び順をシャッフルできるのはロビー中だけです。",
    allPlayersReady: "全員が READY になるまで開始できません。",
    noAttemptsLeft: "これ以上は生成できません。",
    promptNotStarted: "まだプロンプト入力を開始できません。",
    roundInactive: "このラウンドは現在進行中ではありません。",
    roundAlreadyEnded: "このラウンドはすでに終了しています。",
    voteSelf: "自分自身には投票できません。",
    voteCpu: "CPU は API から投票できません。",
    voteClosed: "投票フェーズは現在終了しています。",
    votesLocked: "投票はすでに確定しています。",
    roomMissing: "ルームが存在しません。",
    playerMissing: "プレイヤー情報が見つかりません。",
    roundMissing: "ラウンド情報が見つかりません。",
    turnMismatch: "現在はこの操作を実行できません。",
    gcpExpired: "Google Cloud 認証の更新が必要です。",
    rateLimited: "処理が混み合っています。少し待ってから再試行してください。",
  },
  en: {
    roomNotInLobby: "This room is not currently in the lobby.",
    roomAlreadyFull: "This room is already full.",
    onlyHost: "Only the host can perform this action.",
    onlyHostNextRound: "Only the host can move to the next round.",
    readyOnlyInLobby: "READY can only be changed while the room is in the lobby.",
    settingsOnlyInLobby: "Room settings can only be changed while the room is in the lobby.",
    shuffleOnlyInLobby: "You can only shuffle the order while the room is in the lobby.",
    allPlayersReady: "Everyone must be READY before the round can start.",
    noAttemptsLeft: "You have no attempts left.",
    promptNotStarted: "Prompt input has not opened yet.",
    roundInactive: "This round is not currently active.",
    roundAlreadyEnded: "This round has already ended.",
    voteSelf: "You cannot vote for yourself.",
    voteCpu: "CPU players cannot vote through the API.",
    voteClosed: "Voting is no longer active.",
    votesLocked: "Votes are already locked.",
    roomMissing: "The room does not exist.",
    playerMissing: "The player could not be found.",
    roundMissing: "The round could not be found.",
    turnMismatch: "This action is not available right now.",
    gcpExpired: "Google Cloud authentication needs to be refreshed.",
    rateLimited: "The server is busy right now. Please try again in a moment.",
  },
};

export function toUiError(error: unknown, localFallback: LocalErrorKey): UiError {
  if (error instanceof ApiClientError) {
    return {
      kind: "api",
      code: error.code,
      message: error.message,
    };
  }

  return {
    kind: "local",
    key: localFallback,
  };
}

export function resolveApiErrorMessage(
  language: Language,
  code: ErrorCode,
  rawMessage?: string | null,
): string {
  if (rawMessage) {
    const overrideKey = API_MESSAGE_MAP[rawMessage];
    if (overrideKey) {
      return API_MESSAGE_MESSAGES[language][overrideKey];
    }
  }

  return API_CODE_MESSAGES[language][code];
}

export function resolveUiErrorMessage(language: Language, error: UiError): string {
  if (error.kind === "local") {
    return LOCAL_ERROR_MESSAGES[language][error.key];
  }

  return resolveApiErrorMessage(language, error.code, error.message);
}
