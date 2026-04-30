import { describe, expect, it } from "vitest";

import {
  mapContainedFramePointToImagePoint,
  projectImagePointToContainedFrame,
} from "@/lib/client/image-coordinate";

describe("image coordinate mapping", () => {
  it("maps and projects points through object-contain letterboxing symmetrically", () => {
    const frame = { width: 160, height: 90 };
    const imageAspectRatio = 1;

    expect(
      mapContainedFramePointToImagePoint({
        frame,
        imageAspectRatio,
        localX: 35,
        localY: 45,
      }),
    ).toEqual({
      x: 0,
      y: 0.5,
    });

    expect(
      projectImagePointToContainedFrame({
        frame,
        imageAspectRatio,
        point: { x: 0, y: 0.5 },
      }),
    ).toEqual({
      left: 21.875,
      top: 50,
    });
  });
});
