import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyAuthHeader, type AuthContext } from "@/lib/auth/verify-id-token";
import { AppError, toErrorResponse } from "@/lib/utils/errors";

export type ApiHandler<T> = (ctx: {
  body: T;
  auth: AuthContext;
}) => Promise<NextResponse>;

export function ok<T extends Record<string, unknown>>(data: T): NextResponse {
  return NextResponse.json({ ok: true, ...data });
}

export function withPostHandler<T>(
  schema: z.ZodType<T>,
  handler: ApiHandler<T>,
): (request: Request) => Promise<NextResponse> {
  return async function routeHandler(request: Request): Promise<NextResponse> {
    try {
      const auth = await verifyAuthHeader(request.headers.get("authorization"));
      const json = await request.json();
      const body = schema.parse(json);
      return await handler({ body, auth });
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
