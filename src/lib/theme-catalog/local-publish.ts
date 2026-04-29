import { readFile } from "node:fs/promises";

import { uploadImageToStorage } from "@/lib/storage/upload-image";
import {
  normalizeAnswerBox,
  upsertAhaChangeBySource,
  upsertAhaThemeBySource,
} from "@/lib/theme-catalog/aha";
import { listLocalAhaAssets, resolveAhaSourceDir } from "@/lib/theme-catalog/local-assets";

export interface PublishAhaAssetsResult {
  themes: number;
  changes: number;
  skippedUnannotated: number;
  skippedMissingPrompts: number;
}

export async function publishAnnotatedAhaAssets(
  sourceDir = resolveAhaSourceDir(),
): Promise<PublishAhaAssetsResult> {
  const themes = await listLocalAhaAssets(sourceDir);
  const result: PublishAhaAssetsResult = {
    themes: 0,
    changes: 0,
    skippedUnannotated: 0,
    skippedMissingPrompts: themes.reduce(
      (total, theme) => total + theme.missingPromptImageIds.length,
      0,
    ),
  };

  for (const theme of themes) {
    const annotatedChanges = theme.changes.filter((change) => change.annotation);
    result.skippedUnannotated += theme.changes.length - annotatedChanges.length;

    if (annotatedChanges.length === 0) {
      continue;
    }

    const baseBlobPath = `aha/${theme.slug}/${theme.base.id}/base.png`;
    const baseBlobUrl = await uploadImageToStorage({
      path: baseBlobPath,
      buffer: await readFile(theme.base.imagePath),
      mimeType: "image/png",
    });
    const savedTheme = await upsertAhaThemeBySource({
      status: "approved",
      imageModel: "gemini",
      aspectRatio: theme.aspectRatio,
      prompt: theme.base.prompt,
      title: theme.title,
      tags: theme.tags,
      difficulty: theme.difficulty,
      blobUrl: baseBlobUrl,
      blobPath: baseBlobPath,
      thumbBlobUrl: baseBlobUrl,
      thumbBlobPath: baseBlobPath,
      stylePresetId: theme.style,
      source: "imported",
      sourceSlug: theme.slug,
      sourceAssetId: theme.base.id,
    });
    result.themes += 1;

    for (const change of annotatedChanges) {
      const changedBlobPath = `aha/${theme.slug}/${theme.base.id}/changes/${change.id}.png`;
      const changedBlobUrl = await uploadImageToStorage({
        path: changedBlobPath,
        buffer: await readFile(change.imagePath),
        mimeType: "image/png",
      });

      await upsertAhaChangeBySource({
        themeId: savedTheme.id,
        status: "approved",
        editPrompt: change.editPrompt,
        changedBlobUrl,
        changedBlobPath,
        answerBox: normalizeAnswerBox(change.annotation),
        changeSummary: change.changeSummary,
        sourceSlug: theme.slug,
        sourceChangeId: change.id,
      });
      result.changes += 1;
    }
  }

  return result;
}
