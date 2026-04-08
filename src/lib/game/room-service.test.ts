import { describe, expect, it } from "vitest";

import { __test__ as roundServiceTest } from "@/lib/game/round-service";
import { AppError } from "@/lib/utils/errors";
import { assertCanStartRound, selectNextHost, shufflePlayers } from "@/lib/game/room-service";

describe("room-service", () => {
  describe("selectNextHost", () => {
    it("returns existing host when present", () => {
      const host = selectNextHost([
        { uid: "u1", isHost: true, kind: "human" },
        { uid: "u2", isHost: false, kind: "human" },
      ]);

      expect(host).toBe("u1");
    });

    it("returns oldest player when no host exists", () => {
      const host = selectNextHost([
        { uid: "u2", isHost: false, kind: "human", joinedAt: new Date("2026-02-21T10:00:00Z") },
        { uid: "u1", isHost: false, kind: "human", joinedAt: new Date("2026-02-21T09:00:00Z") },
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

  describe("shufflePlayers", () => {
    it("returns a shuffled copy without mutating the original array", () => {
      const original = ["host", "guest", "cpu-1"];
      const shuffled = shufflePlayers(original, () => 0);

      expect(original).toEqual(["host", "guest", "cpu-1"]);
      expect(shuffled).toEqual(["guest", "cpu-1", "host"]);
    });
  });

  describe("describeRoundGenerationError", () => {
    it("surfaces missing blob token as a configuration error", () => {
      const error = roundServiceTest.describeRoundGenerationError(
        new AppError("INTERNAL_ERROR", "BLOB_READ_WRITE_TOKEN is missing", false, 500),
      );

      expect(error).toMatchObject({
        code: "INTERNAL_ERROR",
        status: 503,
        retryable: false,
      });
      expect(error.message).toContain("BLOB_READ_WRITE_TOKEN");
    });

    it("surfaces generation state conflicts separately", () => {
      const error = roundServiceTest.describeRoundGenerationError(
        new AppError("ROUND_CLOSED", "Round generation state was replaced", false, 409),
      );

      expect(error).toMatchObject({
        code: "ROUND_CLOSED",
        status: 409,
        retryable: false,
      });
      expect(error.message).toContain("状態が競合");
    });
  });
});
