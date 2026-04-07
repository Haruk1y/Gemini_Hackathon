import { describe, expect, it } from "vitest";

import { parseDate } from "@/lib/utils/time";

describe("parseDate", () => {
  it("parses Firestore timestamp-like objects with numeric fields", () => {
    const parsed = parseDate({
      _seconds: 1_775_147_200,
      _nanoseconds: 500_000_000,
    });

    expect(parsed?.toISOString()).toBe("2026-04-02T16:26:40.500Z");
  });

  it("parses Firestore timestamp-like objects with string fields", () => {
    const parsed = parseDate({
      seconds: "1775147200",
      nanoseconds: "250000000",
    });

    expect(parsed?.toISOString()).toBe("2026-04-02T16:26:40.250Z");
  });
});
