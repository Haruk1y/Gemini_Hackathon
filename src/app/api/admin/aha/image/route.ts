import { readFile } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { assertLocalAhaAdminRequest } from "@/lib/theme-catalog/admin-auth";
import { resolveLocalAhaImagePath } from "@/lib/theme-catalog/local-assets";
import { toErrorResponse } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertLocalAhaAdminRequest(request);
    const themeSlug = request.nextUrl.searchParams.get("themeSlug") ?? "";
    const assetId = request.nextUrl.searchParams.get("assetId") ?? "";
    const imagePath = await resolveLocalAhaImagePath({ themeSlug, assetId });
    const image = await readFile(imagePath);

    return new NextResponse(image, {
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
