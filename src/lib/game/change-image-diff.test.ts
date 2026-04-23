import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  ChangeImageDiffError,
  computeDiffBoundingBox,
  computeLocalizedChangeImageDiff,
  computePaddedNormalizedDiffBoundingBox,
  decodePngImage,
} from "@/lib/game/change-image-diff";

interface RectFill {
  x: number;
  y: number;
  width: number;
  height: number;
  rgba?: [number, number, number, number];
}

describe("change image diff", () => {
  it("returns a padded normalized bbox for a single localized diff", () => {
    const beforeBuffer = createPngBuffer(10, 10);
    const afterBuffer = createPngBuffer(10, 10, [
      {
        x: 3,
        y: 4,
        width: 2,
        height: 2,
        rgba: [0, 0, 0, 255],
      },
    ]);

    const beforeImage = decodePngImage(beforeBuffer);
    const afterImage = decodePngImage(toDataUrl(afterBuffer));

    expect(computeDiffBoundingBox(beforeImage, afterImage)).toEqual({
      left: 3,
      top: 4,
      right: 4,
      bottom: 5,
      width: 2,
      height: 2,
      area: 4,
    });
    expect(
      computePaddedNormalizedDiffBoundingBox(beforeImage, afterImage, 1),
    ).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.4,
      height: 0.4,
    });
    expect(
      computeLocalizedChangeImageDiff(beforeBuffer, toDataUrl(afterBuffer), {
        paddingPixels: 1,
      }),
    ).toMatchObject({
      boundingBox: {
        left: 3,
        top: 4,
        right: 4,
        bottom: 5,
        width: 2,
        height: 2,
        area: 4,
      },
      paddedBoundingBox: {
        left: 2,
        top: 3,
        right: 5,
        bottom: 6,
        width: 4,
        height: 4,
        area: 16,
      },
      normalizedBoundingBox: {
        x: 0.2,
        y: 0.3,
        width: 0.4,
        height: 0.4,
      },
      diffPixelCount: 4,
      diffPixelRatio: 0.04,
      regionCount: 1,
    });
  });

  it("rejects identical images", () => {
    const imageBuffer = createPngBuffer(10, 10);
    const image = decodePngImage(imageBuffer);

    expect(computePaddedNormalizedDiffBoundingBox(image, image)).toBeNull();
    expect(
      expectDiffError(() =>
        computeLocalizedChangeImageDiff(imageBuffer, imageBuffer),
      ),
    ).toMatchObject({
      code: "EMPTY_DIFF",
      message: "Images are identical; no localized change was found.",
    });
  });

  it("rejects diffs that cover too much of the image", () => {
    const beforeBuffer = createPngBuffer(10, 10);
    const afterBuffer = createPngBuffer(10, 10, [
      {
        x: 2,
        y: 2,
        width: 6,
        height: 6,
        rgba: [0, 0, 0, 255],
      },
    ]);

    expect(
      expectDiffError(() =>
        computeLocalizedChangeImageDiff(beforeBuffer, afterBuffer, {
          paddingPixels: 0,
          maxDiffAreaRatio: 0.35,
        }),
      ),
    ).toMatchObject({
      code: "DIFF_TOO_LARGE",
      message: "Localized diff covers too much of the image.",
      details: {
        paddedAreaRatio: 0.36,
        maxDiffAreaRatio: 0.35,
      },
    });
  });

  it("rejects multi-region diffs", () => {
    const beforeBuffer = createPngBuffer(10, 10);
    const afterBuffer = createPngBuffer(10, 10, [
      {
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        rgba: [0, 0, 0, 255],
      },
      {
        x: 6,
        y: 1,
        width: 2,
        height: 2,
        rgba: [0, 0, 0, 255],
      },
    ]);

    expect(
      expectDiffError(() =>
        computeLocalizedChangeImageDiff(beforeBuffer, afterBuffer, {
          paddingPixels: 0,
        }),
      ),
    ).toMatchObject({
      code: "MULTI_REGION_DIFF",
      message: "Expected a single localized diff region, found 2.",
      details: {
        regionCount: 2,
      },
    });
  });
});

function createPngBuffer(
  width: number,
  height: number,
  fills: RectFill[] = [],
) {
  const png = new PNG({ width, height });
  png.data.fill(255);

  for (const fill of fills) {
    const rgba = fill.rgba ?? [0, 0, 0, 255];

    for (let y = fill.y; y < fill.y + fill.height; y += 1) {
      for (let x = fill.x; x < fill.x + fill.width; x += 1) {
        const offset = (width * y + x) * 4;
        png.data[offset] = rgba[0];
        png.data[offset + 1] = rgba[1];
        png.data[offset + 2] = rgba[2];
        png.data[offset + 3] = rgba[3];
      }
    }
  }

  return PNG.sync.write(png);
}

function toDataUrl(buffer: Uint8Array) {
  return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
}

function expectDiffError(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ChangeImageDiffError);
    return error as ChangeImageDiffError;
  }

  throw new Error("Expected change image diff utility to throw.");
}
