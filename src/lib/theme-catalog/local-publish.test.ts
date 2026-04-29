import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUploadImageToStorage,
  mockUpsertAhaThemeBySource,
  mockUpsertAhaChangeBySource,
} = vi.hoisted(() => ({
  mockUploadImageToStorage: vi.fn(),
  mockUpsertAhaThemeBySource: vi.fn(),
  mockUpsertAhaChangeBySource: vi.fn(),
}));

vi.mock("@/lib/storage/upload-image", () => ({
  uploadImageToStorage: mockUploadImageToStorage,
}));

vi.mock("@/lib/theme-catalog/aha", async () => {
  const actual = await vi.importActual<typeof import("@/lib/theme-catalog/aha")>(
    "@/lib/theme-catalog/aha",
  );

  return {
    ...actual,
    upsertAhaThemeBySource: mockUpsertAhaThemeBySource,
    upsertAhaChangeBySource: mockUpsertAhaChangeBySource,
  };
});

let tempDir = "";

async function writePublishFixture() {
  const dir = path.join(tempDir, "Bus_stop");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "prompt.md"),
    [
      `(base1)
You are an image generation model creating a base image for an Aha Experience visual quiz.

Selected style:
Simple geometric illustration

Selected theme:
Bus stop

Target difficulty:
4

Aspect ratio:
16:9`,
      `(change1)
Edit the provided image while preserving the original style. Modify exactly one object only: the sign panel. Use a tight object-only mask.`,
      `(change2)
Edit the provided image while preserving the original style. Modify exactly one object only: the trash can. Use a tight object-only mask.`,
    ].join("\n---\n"),
  );
  await writeFile(path.join(dir, "asset_base1_base.png"), "base");
  await writeFile(path.join(dir, "asset_change1_changed.png"), "change1");
  await writeFile(path.join(dir, "asset_change2_changed.png"), "change2");
  await writeFile(
    path.join(dir, ".aha-annotations.json"),
    JSON.stringify({
      version: 1,
      changes: {
        change1: {
          answerBox: {
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.3,
          },
          updatedAt: "2026-04-29T00:00:00.000Z",
        },
      },
    }),
  );
}

describe("publishAnnotatedAhaAssets", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aha-publish-"));
    mockUploadImageToStorage.mockImplementation(({ path: blobPath }) =>
      Promise.resolve(`https://blob.example/${blobPath}`),
    );
    mockUpsertAhaThemeBySource.mockResolvedValue({
      id: "theme-id",
    });
    mockUpsertAhaChangeBySource.mockResolvedValue({
      id: "change-id",
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uploads and registers annotated changes only", async () => {
    await writePublishFixture();
    const { publishAnnotatedAhaAssets } = await import(
      "@/lib/theme-catalog/local-publish"
    );

    await expect(publishAnnotatedAhaAssets(tempDir)).resolves.toMatchObject({
      themes: 1,
      changes: 1,
      skippedUnannotated: 1,
    });

    expect(mockUploadImageToStorage).toHaveBeenCalledTimes(2);
    expect(mockUpsertAhaThemeBySource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSlug: "Bus_stop",
        sourceAssetId: "base1",
        status: "approved",
      }),
    );
    expect(mockUpsertAhaChangeBySource).toHaveBeenCalledWith(
      expect.objectContaining({
        themeId: "theme-id",
        sourceChangeId: "change1",
        status: "approved",
      }),
    );
  });
});
