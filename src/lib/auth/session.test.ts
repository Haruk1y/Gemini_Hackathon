import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAnonymousSession,
  decodeSessionCookie,
  encodeSessionCookie,
} from "@/lib/auth/session";

const originalSecret = process.env.SESSION_SECRET;

describe("session cookies", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
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
});
