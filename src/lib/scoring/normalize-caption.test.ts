import { describe, expect, it } from "vitest";

import { normalizeCaption } from "@/lib/scoring/normalize-caption";

describe("normalizeCaption", () => {
  it("is deterministic regardless of array order", () => {
    const a = normalizeCaption({
      scene: "Cat at neon stand",
      mainSubjects: ["cat", "chef"],
      keyObjects: ["sushi", "lantern"],
      colors: ["red", "blue"],
      style: "sticker",
      composition: "center",
      textInImage: null,
    });

    const b = normalizeCaption({
      scene: "cat at neon stand",
      mainSubjects: ["chef", "cat"],
      keyObjects: ["lantern", "sushi"],
      colors: ["blue", "red"],
      style: "sticker",
      composition: "center",
      textInImage: null,
    });

    expect(a).toBe(b);
  });
});
