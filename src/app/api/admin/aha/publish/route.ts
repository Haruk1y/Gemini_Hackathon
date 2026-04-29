import { NextRequest, NextResponse } from "next/server";

import { assertLocalAhaAdminRequest } from "@/lib/theme-catalog/admin-auth";
import { publishAnnotatedAhaAssets } from "@/lib/theme-catalog/local-publish";
import { toErrorResponse } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    assertLocalAhaAdminRequest(request);
    const result = await publishAnnotatedAhaAssets();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
