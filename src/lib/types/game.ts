export type RoomStatus =
  | "LOBBY"
  | "GENERATING_ROUND"
  | "IN_ROUND"
  | "RESULTS"
  | "FINISHED";

export type RoundStatus = "GENERATING" | "IN_ROUND" | "RESULTS";

export type AspectRatio = "1:1" | "16:9" | "9:16";
export type GameMode = "classic" | "memory";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "ROOM_NOT_FOUND"
  | "ROUND_NOT_FOUND"
  | "PLAYER_NOT_FOUND"
  | "NOT_HOST"
  | "ROOM_NOT_JOINABLE"
  | "ROUND_CLOSED"
  | "MAX_ATTEMPTS_REACHED"
  | "HINT_LIMIT_REACHED"
  | "RATE_LIMIT"
  | "GEMINI_ERROR"
  | "GCP_ERROR"
  | "INTERNAL_ERROR";

export interface RoomSettings {
  maxPlayers: number;
  roundSeconds: number;
  maxAttempts: number;
  aspectRatio: AspectRatio;
  imageModel: "flash";
  hintLimit: number;
  totalRounds: number;
  gameMode: GameMode;
}

export interface RoomDoc {
  roomId: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
  createdByUid: string;
  status: RoomStatus;
  currentRoundId: string | null;
  roundIndex: number;
  settings: RoomSettings;
  ui: {
    theme: "neo-brutal";
  };
}

export interface PlayerDoc {
  uid: string;
  displayName: string;
  isHost: boolean;
  joinedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  ready: boolean;
  totalScore: number;
}

export interface RoundPublicDoc {
  roundId: string;
  index: number;
  status: RoundStatus;
  createdAt: Date;
  expiresAt: Date;
  startedAt: Date | null;
  promptStartsAt: Date | null;
  endsAt: Date | null;
  targetImageUrl: string;
  targetThumbUrl: string;
  gmTitle: string;
  gmTags: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  reveal: {
    targetCaption?: string;
    gmPromptPublic?: string;
  };
  stats: {
    submissions: number;
    topScore: number;
  };
}

export interface RoundPrivateDoc {
  roundId: string;
  createdAt: Date;
  expiresAt: Date;
  gmPrompt: string;
  gmNegativePrompt?: string;
  targetCaptionJson: unknown;
  targetCaptionText: string;
  safety: {
    blocked: boolean;
    reason?: string;
  };
}

export interface AttemptItem {
  attemptNo: number;
  prompt: string;
  imageUrl: string;
  captionText: string;
  score: number;
  createdAt: Date;
}

export interface AttemptsPrivateDoc {
  uid: string;
  roundId: string;
  expiresAt: Date;
  attemptsUsed: number;
  hintUsed: number;
  bestScore: number;
  bestAttemptNo: number | null;
  attempts: AttemptItem[];
  updatedAt: Date;
}

export interface ScoreDoc {
  uid: string;
  displayName: string;
  bestScore: number;
  bestImageUrl: string;
  bestPromptPublic?: string;
  updatedAt: Date;
  expiresAt: Date;
}

export interface ApiErrorShape {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface ApiErrorResponse {
  ok: false;
  error: ApiErrorShape;
}

export interface ApiSuccessResponse<T extends Record<string, unknown>> {
  ok: true;
  data: T;
}
