import { describe, expect, it } from "vitest";

import { cosineToScore } from "@/lib/scoring/cosine";

describe("cosineToScore", () => {
  it("clamps to 0..100", () => {
    expect(cosineToScore(-1)).toBe(0);
    expect(cosineToScore(0)).toBe(0);
    expect(cosineToScore(0.5)).toBe(50);
    expect(cosineToScore(1)).toBe(100);
    expect(cosineToScore(2)).toBe(100);
  });
});
