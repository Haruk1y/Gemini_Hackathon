import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/utils/errors";
import { assertCanStartRound, selectNextHost } from "@/lib/game/room-service";

describe("room-service", () => {
  describe("selectNextHost", () => {
    it("returns existing host when present", () => {
      const host = selectNextHost([
        { uid: "u1", isHost: true },
        { uid: "u2", isHost: false },
      ]);

      expect(host).toBe("u1");
    });

    it("returns oldest player when no host exists", () => {
      const host = selectNextHost([
        { uid: "u2", isHost: false, joinedAt: new Date("2026-02-21T10:00:00Z") },
        { uid: "u1", isHost: false, joinedAt: new Date("2026-02-21T09:00:00Z") },
      ]);

      expect(host).toBe("u1");
    });

    it("returns null when there are no players", () => {
      expect(selectNextHost([])).toBeNull();
    });
  });

  describe("assertCanStartRound", () => {
    it("allows start when one ready player is present", () => {
      expect(() => assertCanStartRound([{ ready: true }])).not.toThrow();
    });

    it("allows start when multiple players are all ready", () => {
      expect(() =>
        assertCanStartRound([{ ready: true }, { ready: true }, { ready: true }]),
      ).not.toThrow();
    });

    it("rejects start with no players", () => {
      expect(() => assertCanStartRound([])).toThrow(AppError);
    });

    it("rejects start when someone is not ready", () => {
      expect(() =>
        assertCanStartRound([{ ready: true }, { ready: false }]),
      ).toThrow(AppError);
    });
  });
});
