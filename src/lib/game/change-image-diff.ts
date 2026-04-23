import { PNG } from "pngjs";

export type PngSource = Uint8Array | string;

export interface DecodedPngImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface DiffBoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  area: number;
}

export interface NormalizedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChangeImageDiffOptions {
  paddingPixels?: number;
  maxDiffAreaRatio?: number;
  colorChannelThreshold?: number;
  totalColorThreshold?: number;
  alphaThreshold?: number;
  minRegionPixelCount?: number;
  mergeGapPixels?: number;
  allowMultipleRegions?: boolean;
}

export interface LocalizedImageDiff {
  boundingBox: DiffBoundingBox;
  paddedBoundingBox: DiffBoundingBox;
  normalizedBoundingBox: NormalizedBoundingBox;
  diffPixelCount: number;
  diffPixelRatio: number;
  regionCount: number;
}

export type ChangeImageDiffErrorCode =
  | "INVALID_PNG"
  | "IMAGE_SIZE_MISMATCH"
  | "EMPTY_DIFF"
  | "DIFF_TOO_LARGE"
  | "MULTI_REGION_DIFF";

export class ChangeImageDiffError extends Error {
  readonly code: ChangeImageDiffErrorCode;
  readonly details?: Record<string, number>;

  constructor(
    code: ChangeImageDiffErrorCode,
    message: string,
    details?: Record<string, number>,
  ) {
    super(message);
    this.name = "ChangeImageDiffError";
    this.code = code;
    this.details = details;
  }
}

export const DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS = {
  paddingPixels: 1,
  maxDiffAreaRatio: 0.35,
  colorChannelThreshold: 24,
  totalColorThreshold: 48,
  alphaThreshold: 32,
  mergeGapPixels: 12,
} as const;

interface DiffMaskResult {
  boundingBox: DiffBoundingBox | null;
  diffMask: Uint8Array;
  diffPixelCount: number;
}

interface DiffRegion extends DiffBoundingBox {
  pixelCount: number;
}

interface DiffRegionCluster extends DiffBoundingBox {
  pixelCount: number;
  regionCount: number;
}

interface PixelDiffThresholds {
  colorChannelThreshold: number;
  totalColorThreshold: number;
  alphaThreshold: number;
}

export function decodePngImage(source: PngSource): DecodedPngImage {
  const pngBuffer = toPngBuffer(source);

  try {
    const png = PNG.sync.read(pngBuffer);
    return {
      width: png.width,
      height: png.height,
      data: Uint8Array.from(png.data),
    };
  } catch {
    throw new ChangeImageDiffError(
      "INVALID_PNG",
      "Failed to decode PNG image data.",
    );
  }
}

export function computeDiffBoundingBox(
  before: DecodedPngImage,
  after: DecodedPngImage,
): DiffBoundingBox | null {
  return buildDiffMask(before, after).boundingBox;
}

export function computePaddedNormalizedDiffBoundingBox(
  before: DecodedPngImage,
  after: DecodedPngImage,
  paddingPixels = DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.paddingPixels,
): NormalizedBoundingBox | null {
  const boundingBox = computeDiffBoundingBox(before, after);

  if (!boundingBox) {
    return null;
  }

  const paddedBoundingBox = padBoundingBox(
    boundingBox,
    before.width,
    before.height,
    paddingPixels,
  );

  return {
    x: paddedBoundingBox.left / before.width,
    y: paddedBoundingBox.top / before.height,
    width: paddedBoundingBox.width / before.width,
    height: paddedBoundingBox.height / before.height,
  };
}

export function computeLocalizedChangeImageDiff(
  beforeSource: PngSource,
  afterSource: PngSource,
  options: ChangeImageDiffOptions = {},
): LocalizedImageDiff {
  const before = decodePngImage(beforeSource);
  const after = decodePngImage(afterSource);
  assertSameImageSize(before, after);
  const totalPixelCount = before.width * before.height;

  const paddingPixels = normalizePaddingPixels(
    options.paddingPixels ?? DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.paddingPixels,
  );
  const maxDiffAreaRatio = normalizeMaxDiffAreaRatio(
    options.maxDiffAreaRatio ??
      DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.maxDiffAreaRatio,
  );
  const pixelThresholds = resolvePixelDiffThresholds(options);
  const minRegionPixelCount = resolveMinRegionPixelCount(
    totalPixelCount,
    options.minRegionPixelCount,
  );
  const mergeGapPixels = resolveMergeGapPixels(
    before.width,
    before.height,
    options.mergeGapPixels,
  );
  const allowMultipleRegions = options.allowMultipleRegions === true;

  const { boundingBox, diffMask, diffPixelCount } = buildDiffMask(
    before,
    after,
    pixelThresholds,
  );

  if (!boundingBox) {
    throw new ChangeImageDiffError(
      "EMPTY_DIFF",
      "Images are identical; no localized change was found.",
    );
  }

  const regions = findDiffRegions(diffMask, before.width, before.height);
  const significantRegions = regions.filter(
    (region) => region.pixelCount >= minRegionPixelCount,
  );
  const mergedRegions = mergeDiffRegions(significantRegions, mergeGapPixels);

  if (mergedRegions.length === 0) {
    throw new ChangeImageDiffError(
      "EMPTY_DIFF",
      "No localized change remained after filtering low-level image noise.",
      {
        minRegionPixelCount,
        regionCount: regions.length,
      },
    );
  }

  if (!allowMultipleRegions && mergedRegions.length !== 1) {
    throw new ChangeImageDiffError(
      "MULTI_REGION_DIFF",
      `Expected a single localized diff region, found ${mergedRegions.length}.`,
      {
        regionCount: mergedRegions.length,
      },
    );
  }

  const primaryRegion = selectPrimaryDiffRegion(mergedRegions);
  const paddedBoundingBox = padBoundingBox(
    primaryRegion,
    before.width,
    before.height,
    paddingPixels,
  );
  const paddedAreaRatio = paddedBoundingBox.area / totalPixelCount;

  if (paddedAreaRatio > maxDiffAreaRatio) {
    throw new ChangeImageDiffError(
      "DIFF_TOO_LARGE",
      "Localized diff covers too much of the image.",
      {
        paddedAreaRatio,
        maxDiffAreaRatio,
      },
    );
  }

  return {
    boundingBox: primaryRegion,
    paddedBoundingBox,
    normalizedBoundingBox: {
      x: paddedBoundingBox.left / before.width,
      y: paddedBoundingBox.top / before.height,
      width: paddedBoundingBox.width / before.width,
      height: paddedBoundingBox.height / before.height,
    },
    diffPixelCount: primaryRegion.pixelCount,
    diffPixelRatio: primaryRegion.pixelCount / totalPixelCount,
    regionCount: mergedRegions.length,
  };
}

function selectPrimaryDiffRegion(regions: DiffRegionCluster[]) {
  return [...regions].sort((left, right) => {
    if (left.pixelCount !== right.pixelCount) {
      return right.pixelCount - left.pixelCount;
    }

    if (left.area !== right.area) {
      return right.area - left.area;
    }

    return left.top - right.top;
  })[0]!;
}

function resolvePixelDiffThresholds(
  options: ChangeImageDiffOptions,
): PixelDiffThresholds {
  return {
    colorChannelThreshold: normalizeThresholdValue(
      options.colorChannelThreshold ??
        DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.colorChannelThreshold,
    ),
    totalColorThreshold: normalizeThresholdValue(
      options.totalColorThreshold ??
        DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.totalColorThreshold,
    ),
    alphaThreshold: normalizeThresholdValue(
      options.alphaThreshold ?? DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.alphaThreshold,
    ),
  };
}

function resolveMinRegionPixelCount(
  totalPixelCount: number,
  requestedValue: number | undefined,
) {
  if (typeof requestedValue === "number" && Number.isFinite(requestedValue)) {
    return Math.max(1, Math.floor(requestedValue));
  }

  return clamp(Math.round(totalPixelCount * 0.00004), 2, 64);
}

function resolveMergeGapPixels(
  width: number,
  height: number,
  requestedValue: number | undefined,
) {
  if (typeof requestedValue === "number" && Number.isFinite(requestedValue)) {
    return Math.max(0, Math.floor(requestedValue));
  }

  const base = Math.round(Math.min(width, height) * 0.012);
  return clamp(base, 1, DEFAULT_CHANGE_IMAGE_DIFF_OPTIONS.mergeGapPixels);
}

function toPngBuffer(source: PngSource) {
  if (typeof source !== "string") {
    if (source.byteLength === 0) {
      throw new ChangeImageDiffError("INVALID_PNG", "PNG buffer is empty.");
    }

    return Buffer.from(source);
  }

  const trimmedSource = source.trim();

  if (trimmedSource.length === 0) {
    throw new ChangeImageDiffError("INVALID_PNG", "PNG data URL is empty.");
  }

  const commaIndex = trimmedSource.indexOf(",");

  if (!trimmedSource.startsWith("data:") || commaIndex === -1) {
    throw new ChangeImageDiffError(
      "INVALID_PNG",
      "Expected a PNG buffer or base64 PNG data URL.",
    );
  }

  const metadata = trimmedSource.slice(5, commaIndex);

  if (
    !/^image\/png(?:;.*)?$/i.test(metadata) ||
    !/;base64(?:;|$)/i.test(metadata)
  ) {
    throw new ChangeImageDiffError(
      "INVALID_PNG",
      "Only base64 PNG data URLs are supported.",
    );
  }

  const base64Payload = trimmedSource.slice(commaIndex + 1).replace(/\s+/g, "");

  if (base64Payload.length === 0) {
    throw new ChangeImageDiffError(
      "INVALID_PNG",
      "PNG data URL payload is empty.",
    );
  }

  return Buffer.from(base64Payload, "base64");
}

function buildDiffMask(
  before: DecodedPngImage,
  after: DecodedPngImage,
  thresholds: PixelDiffThresholds = {
    colorChannelThreshold: 1,
    totalColorThreshold: 1,
    alphaThreshold: 1,
  },
): DiffMaskResult {
  assertSameImageSize(before, after);

  const totalPixelCount = before.width * before.height;
  const diffMask = new Uint8Array(totalPixelCount);
  let diffPixelCount = 0;
  let left = before.width;
  let top = before.height;
  let right = -1;
  let bottom = -1;

  for (
    let pixelIndex = 0, offset = 0;
    pixelIndex < totalPixelCount;
    pixelIndex += 1, offset += 4
  ) {
    if (!pixelDiffers(before.data, after.data, offset, thresholds)) {
      continue;
    }

    diffMask[pixelIndex] = 1;
    diffPixelCount += 1;

    const x = pixelIndex % before.width;
    const y = Math.floor(pixelIndex / before.width);

    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  if (diffPixelCount === 0) {
    return {
      boundingBox: null,
      diffMask,
      diffPixelCount,
    };
  }

  return {
    boundingBox: createBoundingBox(left, top, right, bottom),
    diffMask,
    diffPixelCount,
  };
}

function findDiffRegions(
  diffMask: Uint8Array,
  width: number,
  height: number,
): DiffRegion[] {
  const visited = new Uint8Array(diffMask.length);
  const regions: DiffRegion[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;

      if (diffMask[pixelIndex] === 0 || visited[pixelIndex] === 1) {
        continue;
      }

      const stack = [pixelIndex];
      visited[pixelIndex] = 1;
      let left = x;
      let top = y;
      let right = x;
      let bottom = y;
      let pixelCount = 0;

      while (stack.length > 0) {
        const currentIndex = stack.pop();

        if (currentIndex === undefined) {
          continue;
        }

        const currentX = currentIndex % width;
        const currentY = Math.floor(currentIndex / width);
        pixelCount += 1;
        left = Math.min(left, currentX);
        top = Math.min(top, currentY);
        right = Math.max(right, currentX);
        bottom = Math.max(bottom, currentY);

        for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
          for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
            if (deltaX === 0 && deltaY === 0) {
              continue;
            }

            const neighborX = currentX + deltaX;
            const neighborY = currentY + deltaY;

            if (
              neighborX < 0 ||
              neighborX >= width ||
              neighborY < 0 ||
              neighborY >= height
            ) {
              continue;
            }

            const neighborIndex = neighborY * width + neighborX;

            if (diffMask[neighborIndex] === 0 || visited[neighborIndex] === 1) {
              continue;
            }

            visited[neighborIndex] = 1;
            stack.push(neighborIndex);
          }
        }
      }

      regions.push({
        ...createBoundingBox(left, top, right, bottom),
        pixelCount,
      });
    }
  }

  return regions;
}

function mergeDiffRegions(
  regions: DiffRegion[],
  mergeGapPixels: number,
): DiffRegionCluster[] {
  if (regions.length === 0) {
    return [];
  }

  const visited = new Uint8Array(regions.length);
  const clusters: DiffRegionCluster[] = [];

  for (let index = 0; index < regions.length; index += 1) {
    if (visited[index] === 1) {
      continue;
    }

    const seed = regions[index]!;
    visited[index] = 1;
    const queue = [index];
    let left = seed.left;
    let top = seed.top;
    let right = seed.right;
    let bottom = seed.bottom;
    let pixelCount = seed.pixelCount;
    let regionCount = 1;

    while (queue.length > 0) {
      const currentIndex = queue.shift();
      if (currentIndex === undefined) {
        continue;
      }

      const currentRegion = regions[currentIndex]!;
      for (let candidateIndex = 0; candidateIndex < regions.length; candidateIndex += 1) {
        if (visited[candidateIndex] === 1) {
          continue;
        }

        const candidate = regions[candidateIndex]!;
        if (!regionsShouldMerge(currentRegion, candidate, mergeGapPixels)) {
          continue;
        }

        visited[candidateIndex] = 1;
        queue.push(candidateIndex);
        left = Math.min(left, candidate.left);
        top = Math.min(top, candidate.top);
        right = Math.max(right, candidate.right);
        bottom = Math.max(bottom, candidate.bottom);
        pixelCount += candidate.pixelCount;
        regionCount += 1;
      }
    }

    clusters.push({
      ...createBoundingBox(left, top, right, bottom),
      pixelCount,
      regionCount,
    });
  }

  return clusters;
}

function regionsShouldMerge(
  first: DiffBoundingBox,
  second: DiffBoundingBox,
  mergeGapPixels: number,
) {
  const horizontalGap = boxAxisGap(first.left, first.right, second.left, second.right);
  const verticalGap = boxAxisGap(first.top, first.bottom, second.top, second.bottom);
  return horizontalGap <= mergeGapPixels && verticalGap <= mergeGapPixels;
}

function boxAxisGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  if (firstEnd < secondStart) {
    return secondStart - firstEnd - 1;
  }

  if (secondEnd < firstStart) {
    return firstStart - secondEnd - 1;
  }

  return 0;
}

function pixelDiffers(
  beforeData: Uint8Array,
  afterData: Uint8Array,
  offset: number,
  thresholds: PixelDiffThresholds,
) {
  const redDelta = Math.abs(beforeData[offset] - afterData[offset]);
  const greenDelta = Math.abs(beforeData[offset + 1] - afterData[offset + 1]);
  const blueDelta = Math.abs(beforeData[offset + 2] - afterData[offset + 2]);
  const alphaDelta = Math.abs(beforeData[offset + 3] - afterData[offset + 3]);
  const strongestColorDelta = Math.max(redDelta, greenDelta, blueDelta);
  const totalColorDelta = redDelta + greenDelta + blueDelta;

  return (
    strongestColorDelta >= thresholds.colorChannelThreshold ||
    totalColorDelta >= thresholds.totalColorThreshold ||
    alphaDelta >= thresholds.alphaThreshold
  );
}

function padBoundingBox(
  boundingBox: DiffBoundingBox,
  imageWidth: number,
  imageHeight: number,
  paddingPixels: number,
): DiffBoundingBox {
  const normalizedPaddingPixels = normalizePaddingPixels(paddingPixels);

  const left = clamp(
    boundingBox.left - normalizedPaddingPixels,
    0,
    imageWidth - 1,
  );
  const top = clamp(
    boundingBox.top - normalizedPaddingPixels,
    0,
    imageHeight - 1,
  );
  const right = clamp(
    boundingBox.right + normalizedPaddingPixels,
    0,
    imageWidth - 1,
  );
  const bottom = clamp(
    boundingBox.bottom + normalizedPaddingPixels,
    0,
    imageHeight - 1,
  );

  return createBoundingBox(left, top, right, bottom);
}

function createBoundingBox(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DiffBoundingBox {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    area: (right - left + 1) * (bottom - top + 1),
  };
}

function assertSameImageSize(before: DecodedPngImage, after: DecodedPngImage) {
  if (before.width === after.width && before.height === after.height) {
    return;
  }

  throw new ChangeImageDiffError(
    "IMAGE_SIZE_MISMATCH",
    `Expected matching image sizes, received ${before.width}x${before.height} and ${after.width}x${after.height}.`,
  );
}

function normalizePaddingPixels(paddingPixels: number) {
  if (!Number.isFinite(paddingPixels) || paddingPixels < 0) {
    throw new RangeError(
      "paddingPixels must be a finite number greater than or equal to 0.",
    );
  }

  return Math.floor(paddingPixels);
}

function normalizeMaxDiffAreaRatio(maxDiffAreaRatio: number) {
  if (
    !Number.isFinite(maxDiffAreaRatio) ||
    maxDiffAreaRatio <= 0 ||
    maxDiffAreaRatio > 1
  ) {
    throw new RangeError(
      "maxDiffAreaRatio must be a finite number between 0 and 1.",
    );
  }

  return maxDiffAreaRatio;
}

function normalizeThresholdValue(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "Diff threshold values must be finite numbers greater than or equal to 0.",
    );
  }

  return Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
