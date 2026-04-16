import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAnonymousSession,
  decodeSessionCookie,
  encodeSessionCookie,
  sessionCookieOptions,
} from "@/lib/auth/session";

const originalSecret = process.env.SESSION_SECRET;

describe("session cookies", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.SESSION_SECRET = originalSecret;
  });

  it("round-trips an anonymous session payload", () => {
    const session = createAnonymousSession("anon_test");
    const encoded = encodeSessionCookie(session);

    expect(decodeSessionCookie(encoded)).toEqual(session);
  });

  it("rejects tampered cookies", () => {
    const session = createAnonymousSession("anon_test");
    const encoded = encodeSessionCookie(session);
    const tampered = `${encoded}tampered`;

    expect(decodeSessionCookie(tampered)).toBeNull();
  });

  it("uses third-party compatible cookie attributes in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "none",
      secure: true,
      partitioned: true,
      path: "/",
    });
  });

  it("keeps lax cookies for local development", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      partitioned: false,
      path: "/",
    });
  });
});
