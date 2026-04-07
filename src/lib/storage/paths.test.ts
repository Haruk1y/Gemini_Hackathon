import { describe, expect, it } from "vitest";

import {
  buildPlayerBestImagePath,
  buildRoundTargetImagePath,
} from "@/lib/storage/paths";

describe("storage paths", () => {
  it("stores target images at a stable round target path", () => {
    expect(buildRoundTargetImagePath("ROOM1", "round-1")).toBe(
      "rooms/ROOM1/rounds/round-1/target.png",
    );
  });

  it("stores only one player image per round at the best path", () => {
    expect(buildPlayerBestImagePath("ROOM1", "round-1", "anon_1")).toBe(
      "rooms/ROOM1/rounds/round-1/players/anon_1/best.png",
    );
  });
});
