import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listLocalAhaAssets,
  parseAhaPromptMarkdown,
  saveAhaAnnotation,
} from "@/lib/theme-catalog/local-assets";

let tempDir = "";

function basePrompt(id: string, theme: string) {
  return `(${id})
You are an image generation model creating a base image for an Aha Experience visual quiz.

Selected style:
Simple geometric illustration

Selected theme:
${theme}

Target difficulty:
4

Aspect ratio:
16:9
`;
}

function changePrompt(id: string, target: string) {
  return `(${id})
Edit the provided image while preserving the original style. Modify exactly one object only: ${target}. Use a tight object-only mask around only this target object.`;
}

async function writeTheme(params: {
  slug: string;
  baseId: string;
  changeIds: string[];
  missingPromptImageIds?: string[];
}) {
  const dir = path.join(tempDir, params.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "prompt.md"),
    [
      basePrompt(params.baseId, params.slug),
      ...params.changeIds.map((id, index) => changePrompt(id, `object ${index + 1}`)),
    ].join("\n---\n"),
  );
  await writeFile(path.join(dir, `asset_${params.baseId}_base.png`), "base");
  for (const id of [...params.changeIds, ...(params.missingPromptImageIds ?? [])]) {
    await writeFile(path.join(dir, `asset_${id}_changed.png`), "changed");
  }
}

describe("local Aha assets", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aha-assets-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses prompt sections by asset id", () => {
    expect(parseAhaPromptMarkdown(`${basePrompt("base1", "Bus stop")}\n---\n${changePrompt("chg1", "sign")}`)).toEqual([
      expect.objectContaining({ id: "base1" }),
      expect.objectContaining({ id: "chg1" }),
    ]);
  });

  it("detects valid changes and images missing prompt sections", async () => {
    await writeTheme({
      slug: "Farmers_market",
      baseId: "base-a",
      changeIds: ["change-a", "change-b"],
      missingPromptImageIds: ["missing-a", "missing-b"],
    });
    await writeTheme({
      slug: "Bus_stop",
      baseId: "base-b",
      changeIds: ["change-c", "change-d", "change-e", "change-f"],
    });

    const themes = await listLocalAhaAssets(tempDir);
    expect(themes).toHaveLength(2);
    expect(themes.reduce((count, theme) => count + theme.changes.length, 0)).toBe(6);
    expect(
      themes.reduce((count, theme) => count + theme.missingPromptImageIds.length, 0),
    ).toBe(2);
  });

  it("saves and restores manual answer box annotations", async () => {
    await writeTheme({
      slug: "Bus_stop",
      baseId: "base-b",
      changeIds: ["change-c"],
    });

    await saveAhaAnnotation({
      sourceDir: tempDir,
      themeSlug: "Bus_stop",
      changeId: "change-c",
      answerBox: {
        x: 0.2,
        y: 0.3,
        width: 0.1,
        height: 0.2,
      },
    });

    const rawAnnotation = await readFile(
      path.join(tempDir, "Bus_stop", ".aha-annotations.json"),
      "utf8",
    );
    expect(JSON.parse(rawAnnotation)).toMatchObject({
      changes: {
        "change-c": {
          answerBox: {
            x: 0.2,
            y: 0.3,
            width: 0.1,
            height: 0.2,
          },
        },
      },
    });

    const themes = await listLocalAhaAssets(tempDir);
    expect(themes[0]?.changes[0]?.annotation).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.2,
    });
  });
});
