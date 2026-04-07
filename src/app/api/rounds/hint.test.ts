import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/verify-session", () => ({
  verifySessionCookie: vi.fn(() => ({ uid: "anon_1", issuedAt: Date.now() })),
}));

describe("POST /api/rounds/hint", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a validation error because hints are disabled", async () => {
    const { POST } = await import("@/app/api/rounds/hint/route");
    const request = new NextRequest("http://localhost/api/rounds/hint", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "session=placeholder",
      },
      body: JSON.stringify({
        roomId: "ROOM1",
        roundId: "round-1",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });
});
