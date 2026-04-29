import { NextRequest, NextResponse } from "next/server";

import { assertLocalAhaAdminRequest } from "@/lib/theme-catalog/admin-auth";
import { listLocalAhaAssets } from "@/lib/theme-catalog/local-assets";
import { toErrorResponse } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertLocalAhaAdminRequest(request);
    const themes = await listLocalAhaAssets();
    return NextResponse.json({
      ok: true,
      themes: themes.map((theme) => ({
        slug: theme.slug,
        title: theme.title,
        style: theme.style,
        difficulty: theme.difficulty,
        aspectRatio: theme.aspectRatio,
        tags: theme.tags,
        base: {
          id: theme.base.id,
          prompt: theme.base.prompt,
          fileName: theme.base.fileName,
        },
        changes: theme.changes.map((change) => ({
          id: change.id,
          editPrompt: change.editPrompt,
          changeSummary: change.changeSummary,
          fileName: change.fileName,
          annotation: change.annotation,
        })),
        missingPromptImageIds: theme.missingPromptImageIds,
        missingImagePromptIds: theme.missingImagePromptIds,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
