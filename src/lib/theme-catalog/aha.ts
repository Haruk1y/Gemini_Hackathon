import { requireThemeCatalogSql } from "@/lib/theme-catalog/db";
import type { ThemeCatalogSql } from "@/lib/theme-catalog/db";
import type {
  ApprovedAhaThemeChange,
  ThemeCatalogChange,
  ThemeCatalogItem,
  ThemeCatalogStatus,
  ThemeFeedbackKind,
} from "@/lib/theme-catalog/types";
import type {
  AspectRatio,
  ImageModel,
  NormalizedBox,
} from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

type ThemeCatalogQuery = Pick<ThemeCatalogSql, "query">;
type Row = Record<string, unknown>;

export interface CreateAhaThemeInput {
  status?: ThemeCatalogStatus;
  imageModel: ImageModel;
  aspectRatio: AspectRatio;
  prompt: string;
  title: string;
  tags?: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  blobUrl: string;
  blobPath: string;
  thumbBlobUrl?: string | null;
  thumbBlobPath?: string | null;
  stylePresetId?: string | null;
  source?: "generated" | "manual" | "imported";
  sourceSlug?: string | null;
  sourceAssetId?: string | null;
}

export interface CreateAhaChangeInput {
  themeId: string;
  status?: ThemeCatalogStatus;
  editPrompt: string;
  changedBlobUrl: string;
  changedBlobPath: string;
  answerBox: NormalizedBox;
  changeSummary: string;
  weight?: number;
  sourceSlug?: string | null;
  sourceChangeId?: string | null;
}

export interface ListApprovedAhaChangesInput {
  imageModel?: ImageModel;
  aspectRatio?: AspectRatio;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  limit?: number;
}

export interface RecordAhaChangeFeedbackInput {
  changeId: string;
  kind: ThemeFeedbackKind;
  roomId?: string | null;
  roundId?: string | null;
  uidHash?: string | null;
  note?: string | null;
}

export interface UpsertAhaThemeBySourceInput extends CreateAhaThemeInput {
  sourceSlug: string;
  sourceAssetId: string;
}

export interface UpsertAhaChangeBySourceInput extends CreateAhaChangeInput {
  sourceSlug: string;
  sourceChangeId: string;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("INTERNAL_ERROR", `Invalid theme catalog ${field}`, false, 500);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requireNumber(value: unknown, field: string): number {
  const numberValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isFinite(numberValue)) {
    throw new AppError("INTERNAL_ERROR", `Invalid theme catalog ${field}`, false, 500);
  }

  return numberValue;
}

function requireDate(value: unknown, field: string): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  throw new AppError("INTERNAL_ERROR", `Invalid theme catalog ${field}`, false, 500);
}

function optionalDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }

  return requireDate(value, "date");
}

function requireStatus(value: unknown): ThemeCatalogStatus {
  if (
    value === "pending_review" ||
    value === "approved" ||
    value === "rejected" ||
    value === "disabled"
  ) {
    return value;
  }

  throw new AppError("INTERNAL_ERROR", "Invalid theme catalog status", false, 500);
}

function requireDifficulty(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const difficulty = requireNumber(value, "difficulty");
  if ([1, 2, 3, 4, 5].includes(difficulty)) {
    return difficulty as 1 | 2 | 3 | 4 | 5;
  }

  throw new AppError("INTERNAL_ERROR", "Invalid theme catalog difficulty", false, 500);
}

function requireStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

export function normalizeAnswerBox(value: unknown): NormalizedBox {
  const source =
    typeof value === "string"
      ? (JSON.parse(value) as unknown)
      : value;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new AppError("VALIDATION_ERROR", "answerBox must be an object.", false, 400);
  }

  const record = source as Record<string, unknown>;
  const answerBox = {
    x: requireNumber(record.x, "answerBox.x"),
    y: requireNumber(record.y, "answerBox.y"),
    width: requireNumber(record.width, "answerBox.width"),
    height: requireNumber(record.height, "answerBox.height"),
  };

  if (
    answerBox.x < 0 ||
    answerBox.y < 0 ||
    answerBox.width <= 0 ||
    answerBox.height <= 0 ||
    answerBox.x + answerBox.width > 1 ||
    answerBox.y + answerBox.height > 1
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "answerBox must be normalized within the image bounds.",
      false,
      400,
    );
  }

  return answerBox;
}

export function mapThemeCatalogItemRow(row: Row): ThemeCatalogItem {
  return {
    id: requireString(row.id, "id"),
    status: requireStatus(row.status),
    gameMode: "change",
    imageModel: row.image_model === "flux" ? "flux" : "gemini",
    aspectRatio:
      row.aspect_ratio === "16:9" || row.aspect_ratio === "9:16"
        ? row.aspect_ratio
        : "1:1",
    prompt: requireString(row.prompt, "prompt"),
    title: requireString(row.title, "title"),
    tags: requireStringArray(row.tags),
    difficulty: requireDifficulty(row.difficulty),
    blobUrl: requireString(row.blob_url, "blob_url"),
    blobPath: requireString(row.blob_path, "blob_path"),
    thumbBlobUrl: optionalString(row.thumb_blob_url),
    thumbBlobPath: optionalString(row.thumb_blob_path),
    stylePresetId: optionalString(row.style_preset_id),
    sourceSlug: optionalString(row.source_slug),
    sourceAssetId: optionalString(row.source_asset_id),
    createdAt: requireDate(row.created_at, "created_at"),
    updatedAt: requireDate(row.updated_at, "updated_at"),
  };
}

export function mapThemeCatalogChangeRow(row: Row): ThemeCatalogChange {
  return {
    id: requireString(row.id, "id"),
    themeId: requireString(row.theme_id, "theme_id"),
    status: requireStatus(row.status),
    editPrompt: requireString(row.edit_prompt, "edit_prompt"),
    changedBlobUrl: requireString(row.changed_blob_url, "changed_blob_url"),
    changedBlobPath: requireString(row.changed_blob_path, "changed_blob_path"),
    answerBox: normalizeAnswerBox(row.answer_box),
    changeSummary: requireString(row.change_summary, "change_summary"),
    weight: requireNumber(row.weight, "weight"),
    usageCount: requireNumber(row.usage_count, "usage_count"),
    lastUsedAt: optionalDate(row.last_used_at),
    reviewNote: optionalString(row.review_note),
    reviewedBy: optionalString(row.reviewed_by),
    reviewedAt: optionalDate(row.reviewed_at),
    disabledReason: optionalString(row.disabled_reason),
    sourceSlug: optionalString(row.source_slug),
    sourceChangeId: optionalString(row.source_change_id),
    feedbackOkCount: requireNumber(row.feedback_ok_count, "feedback_ok_count"),
    feedbackLowQualityCount: requireNumber(
      row.feedback_low_quality_count,
      "feedback_low_quality_count",
    ),
    feedbackReportCount: requireNumber(
      row.feedback_report_count,
      "feedback_report_count",
    ),
    createdAt: requireDate(row.created_at, "created_at"),
    updatedAt: requireDate(row.updated_at, "updated_at"),
  };
}

export async function createAhaTheme(
  input: CreateAhaThemeInput,
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<ThemeCatalogItem> {
  const rows = (await sql.query(
    `
      INSERT INTO theme_catalog_items (
        status,
        game_mode,
        image_model,
        aspect_ratio,
        prompt,
        title,
        tags,
        difficulty,
        blob_url,
        blob_path,
        thumb_blob_url,
        thumb_blob_path,
        style_preset_id,
        source,
        source_slug,
        source_asset_id
      )
      VALUES ($1, 'change', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `,
    [
      input.status ?? "pending_review",
      input.imageModel,
      input.aspectRatio,
      input.prompt,
      input.title,
      input.tags ?? [],
      input.difficulty,
      input.blobUrl,
      input.blobPath,
      input.thumbBlobUrl ?? null,
      input.thumbBlobPath ?? null,
      input.stylePresetId ?? null,
      input.source ?? "generated",
      input.sourceSlug ?? null,
      input.sourceAssetId ?? null,
    ],
  )) as Row[];

  return mapThemeCatalogItemRow(rows[0] ?? {});
}

export async function createAhaChange(
  input: CreateAhaChangeInput,
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<ThemeCatalogChange> {
  const answerBox = normalizeAnswerBox(input.answerBox);
  const rows = (await sql.query(
    `
      INSERT INTO theme_catalog_changes (
        theme_id,
        status,
        edit_prompt,
        changed_blob_url,
        changed_blob_path,
        answer_box,
        change_summary,
        weight,
        source_slug,
        source_change_id
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      input.themeId,
      input.status ?? "pending_review",
      input.editPrompt,
      input.changedBlobUrl,
      input.changedBlobPath,
      JSON.stringify(answerBox),
      input.changeSummary,
      input.weight ?? 1,
      input.sourceSlug ?? null,
      input.sourceChangeId ?? null,
    ],
  )) as Row[];

  return mapThemeCatalogChangeRow(rows[0] ?? {});
}

export async function upsertAhaThemeBySource(
  input: UpsertAhaThemeBySourceInput,
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<ThemeCatalogItem> {
  const rows = (await sql.query(
    `
      INSERT INTO theme_catalog_items (
        status,
        game_mode,
        image_model,
        aspect_ratio,
        prompt,
        title,
        tags,
        difficulty,
        blob_url,
        blob_path,
        thumb_blob_url,
        thumb_blob_path,
        style_preset_id,
        source,
        source_slug,
        source_asset_id,
        updated_at
      )
      VALUES ($1, 'change', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
      ON CONFLICT (source_slug, source_asset_id)
        WHERE source_slug IS NOT NULL
          AND source_asset_id IS NOT NULL
      DO UPDATE SET
        status = EXCLUDED.status,
        image_model = EXCLUDED.image_model,
        aspect_ratio = EXCLUDED.aspect_ratio,
        prompt = EXCLUDED.prompt,
        title = EXCLUDED.title,
        tags = EXCLUDED.tags,
        difficulty = EXCLUDED.difficulty,
        blob_url = EXCLUDED.blob_url,
        blob_path = EXCLUDED.blob_path,
        thumb_blob_url = EXCLUDED.thumb_blob_url,
        thumb_blob_path = EXCLUDED.thumb_blob_path,
        style_preset_id = EXCLUDED.style_preset_id,
        source = EXCLUDED.source,
        updated_at = now()
      RETURNING *
    `,
    [
      input.status ?? "approved",
      input.imageModel,
      input.aspectRatio,
      input.prompt,
      input.title,
      input.tags ?? [],
      input.difficulty,
      input.blobUrl,
      input.blobPath,
      input.thumbBlobUrl ?? null,
      input.thumbBlobPath ?? null,
      input.stylePresetId ?? null,
      input.source ?? "imported",
      input.sourceSlug,
      input.sourceAssetId,
    ],
  )) as Row[];

  return mapThemeCatalogItemRow(rows[0] ?? {});
}

export async function upsertAhaChangeBySource(
  input: UpsertAhaChangeBySourceInput,
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<ThemeCatalogChange> {
  const answerBox = normalizeAnswerBox(input.answerBox);
  const rows = (await sql.query(
    `
      INSERT INTO theme_catalog_changes (
        theme_id,
        status,
        edit_prompt,
        changed_blob_url,
        changed_blob_path,
        answer_box,
        change_summary,
        weight,
        source_slug,
        source_change_id,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, now())
      ON CONFLICT (theme_id, source_change_id)
        WHERE source_change_id IS NOT NULL
      DO UPDATE SET
        status = EXCLUDED.status,
        edit_prompt = EXCLUDED.edit_prompt,
        changed_blob_url = EXCLUDED.changed_blob_url,
        changed_blob_path = EXCLUDED.changed_blob_path,
        answer_box = EXCLUDED.answer_box,
        change_summary = EXCLUDED.change_summary,
        weight = EXCLUDED.weight,
        source_slug = EXCLUDED.source_slug,
        updated_at = now()
      RETURNING *
    `,
    [
      input.themeId,
      input.status ?? "approved",
      input.editPrompt,
      input.changedBlobUrl,
      input.changedBlobPath,
      JSON.stringify(answerBox),
      input.changeSummary,
      input.weight ?? 1,
      input.sourceSlug,
      input.sourceChangeId,
    ],
  )) as Row[];

  return mapThemeCatalogChangeRow(rows[0] ?? {});
}

export async function listApprovedAhaChanges(
  input: ListApprovedAhaChangesInput = {},
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<ApprovedAhaThemeChange[]> {
  const params: unknown[] = [];
  const filters = [
    "i.game_mode = 'change'",
    "i.status = 'approved'",
    "c.status = 'approved'",
  ];

  if (input.imageModel) {
    params.push(input.imageModel);
    filters.push(`i.image_model = $${params.length}`);
  }

  if (input.aspectRatio) {
    params.push(input.aspectRatio);
    filters.push(`i.aspect_ratio = $${params.length}`);
  }

  if (input.difficulty) {
    params.push(input.difficulty);
    filters.push(`i.difficulty = $${params.length}`);
  }

  params.push(input.limit ?? 50);
  const limitPlaceholder = `$${params.length}`;
  const rows = (await sql.query(
    `
      SELECT to_jsonb(i.*) AS theme, to_jsonb(c.*) AS change
      FROM theme_catalog_changes c
      INNER JOIN theme_catalog_items i ON i.id = c.theme_id
      WHERE ${filters.join(" AND ")}
      ORDER BY c.usage_count ASC, c.weight DESC, c.created_at DESC
      LIMIT ${limitPlaceholder}
    `,
    params,
  )) as Array<{ theme?: Row; change?: Row }>;

  return rows.map((row) => ({
    theme: mapThemeCatalogItemRow(row.theme ?? {}),
    change: mapThemeCatalogChangeRow(row.change ?? {}),
  }));
}

export async function recordAhaChangeFeedback(
  input: RecordAhaChangeFeedbackInput,
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<{ recorded: boolean }> {
  const rows = (await sql.query(
    `
      WITH inserted AS (
        INSERT INTO theme_catalog_change_feedback (
          theme_change_id,
          kind,
          room_id,
          round_id,
          uid_hash,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (theme_change_id, room_id, round_id, uid_hash, kind)
          WHERE room_id IS NOT NULL
            AND round_id IS NOT NULL
            AND uid_hash IS NOT NULL
          DO NOTHING
        RETURNING theme_change_id, kind
      ),
      updated AS (
        UPDATE theme_catalog_changes
        SET
          feedback_ok_count = feedback_ok_count + CASE
            WHEN EXISTS (SELECT 1 FROM inserted WHERE kind = 'ok') THEN 1
            ELSE 0
          END,
          feedback_low_quality_count = feedback_low_quality_count + CASE
            WHEN EXISTS (SELECT 1 FROM inserted WHERE kind = 'low_quality') THEN 1
            ELSE 0
          END,
          feedback_report_count = feedback_report_count + CASE
            WHEN EXISTS (SELECT 1 FROM inserted WHERE kind = 'report') THEN 1
            ELSE 0
          END,
          updated_at = now()
        WHERE id = $1
          AND EXISTS (SELECT 1 FROM inserted)
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated) AS recorded
    `,
    [
      input.changeId,
      input.kind,
      input.roomId ?? null,
      input.roundId ?? null,
      input.uidHash ?? null,
      input.note ?? null,
    ],
  )) as Array<{ recorded?: boolean }>;

  return {
    recorded: Boolean(rows[0]?.recorded),
  };
}

export async function markAhaChangeUsed(
  changeId: string,
  sql: ThemeCatalogQuery = requireThemeCatalogSql(),
): Promise<ThemeCatalogChange> {
  const rows = (await sql.query(
    `
      UPDATE theme_catalog_changes
      SET usage_count = usage_count + 1,
          last_used_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [changeId],
  )) as Row[];

  return mapThemeCatalogChangeRow(rows[0] ?? {});
}
