import type {
  AspectRatio,
  GameMode,
  ImageModel,
  NormalizedBox,
} from "@/lib/types/game";

export const THEME_CATALOG_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "disabled",
] as const;

export type ThemeCatalogStatus = (typeof THEME_CATALOG_STATUSES)[number];

export const THEME_FEEDBACK_KINDS = [
  "ok",
  "low_quality",
  "report",
] as const;

export type ThemeFeedbackKind = (typeof THEME_FEEDBACK_KINDS)[number];

export interface ThemeCatalogItem {
  id: string;
  status: ThemeCatalogStatus;
  gameMode: GameMode;
  imageModel: ImageModel;
  aspectRatio: AspectRatio;
  prompt: string;
  title: string;
  tags: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  blobUrl: string;
  blobPath: string;
  thumbBlobUrl: string | null;
  thumbBlobPath: string | null;
  stylePresetId: string | null;
  sourceSlug: string | null;
  sourceAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeCatalogChange {
  id: string;
  themeId: string;
  status: ThemeCatalogStatus;
  editPrompt: string;
  changedBlobUrl: string;
  changedBlobPath: string;
  answerBox: NormalizedBox;
  changeSummary: string;
  weight: number;
  usageCount: number;
  lastUsedAt: Date | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  disabledReason: string | null;
  sourceSlug: string | null;
  sourceChangeId: string | null;
  feedbackOkCount: number;
  feedbackLowQualityCount: number;
  feedbackReportCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovedAhaThemeChange {
  theme: ThemeCatalogItem;
  change: ThemeCatalogChange;
}
