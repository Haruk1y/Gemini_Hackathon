import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifySessionCookie, type AuthContext } from "@/lib/auth/verify-session";
import { AppError, toErrorResponse } from "@/lib/utils/errors";

export type ApiHandler<T> = (ctx: {
  body: T;
  auth: AuthContext;
  request: NextRequest;
}) => Promise<NextResponse>;

export function ok<T extends Record<string, unknown>>(data: T): NextResponse {
  return NextResponse.json({ ok: true, ...data });
}

export function withPostHandler<T>(
  schema: z.ZodType<T>,
  handler: ApiHandler<T>,
): (request: NextRequest) => Promise<NextResponse> {
  return async function routeHandler(request: NextRequest): Promise<NextResponse> {
    try {
      const auth = verifySessionCookie(request.cookies);
      const json = await request.json();
      const body = schema.parse(json);
      return await handler({ body, auth, request });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return toErrorResponse(
          new AppError("VALIDATION_ERROR", error.message, false, 400),
        );
      }
      return toErrorResponse(error);
    }
  };
}
