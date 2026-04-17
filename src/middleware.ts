import { NextRequest, NextResponse } from "next/server";

const DEFAULT_ALLOWED_ORIGINS = ["https://supertest.ai.supercell.dev"];

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  const parsed = raw
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter((value) => value.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

const ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.ALLOWED_CORS_ORIGINS ??
    process.env.NEXT_PUBLIC_ALLOWED_CORS_ORIGINS,
);

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function applyCorsHeaders(headers: Headers, origin: string) {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.append("Vary", "Origin");
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    if (isAllowedOrigin(origin)) {
      applyCorsHeaders(response.headers, origin);
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        request.headers.get("access-control-request-headers") ?? "Content-Type",
      );
      response.headers.set("Access-Control-Max-Age", "86400");
    }
    return response;
  }

  const response = NextResponse.next();
  if (isAllowedOrigin(origin)) {
    applyCorsHeaders(response.headers, origin);
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
