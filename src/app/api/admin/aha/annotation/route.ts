import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertLocalAhaAdminRequest } from "@/lib/theme-catalog/admin-auth";
import { normalizeAnswerBox } from "@/lib/theme-catalog/aha";
import { saveAhaAnnotation } from "@/lib/theme-catalog/local-assets";
import { AppError, toErrorResponse } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const annotationSchema = z.object({
  themeSlug: z.string().trim().min(1),
  changeId: z.string().trim().min(1),
  answerBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    assertLocalAhaAdminRequest(request);
    const body = annotationSchema.parse(await request.json());
    const result = await saveAhaAnnotation({
      themeSlug: body.themeSlug,
      changeId: body.changeId,
      answerBox: normalizeAnswerBox(body.answerBox),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return toErrorResponse(
        new AppError("VALIDATION_ERROR", error.message, false, 400),
      );
    }

    return toErrorResponse(error);
  }
}
