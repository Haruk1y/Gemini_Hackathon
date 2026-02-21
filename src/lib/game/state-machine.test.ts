import { describe, expect, it } from "vitest";

import { assertRoomTransition } from "@/lib/game/state-machine";

describe("room state transitions", () => {
  it("accepts valid transitions", () => {
    expect(() => assertRoomTransition("LOBBY", "GENERATING_ROUND")).not.toThrow();
    expect(() => assertRoomTransition("RESULTS", "FINISHED")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => assertRoomTransition("LOBBY", "RESULTS")).toThrow();
    expect(() => assertRoomTransition("IN_ROUND", "LOBBY")).toThrow();
  });
});
