import { NextRequest, NextResponse } from "next/server";

import {
  createAnonymousSession,
  decodeSessionCookie,
  encodeSessionCookie,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const existing = decodeSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const session = existing ?? createAnonymousSession();

  const response = NextResponse.json({
    ok: true,
    uid: session.uid,
    issuedAt: session.issuedAt,
  });

  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(session),
    sessionCookieOptions(),
  );

  return response;
}
