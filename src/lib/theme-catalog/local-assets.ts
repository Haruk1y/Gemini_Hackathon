import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { NormalizedBox } from "@/lib/types/game";
import { AppError } from "@/lib/utils/errors";

export const DEFAULT_AHA_SOURCE_DIR = "/Users/yajima/Documents/aha";
const ANNOTATIONS_FILE = ".aha-annotations.json";

export interface LocalAhaChange {
  id: string;
  editPrompt: string;
  changeSummary: string;
  imagePath: string;
  fileName: string;
  annotation: NormalizedBox | null;
}

export interface LocalAhaTheme {
  slug: string;
  dirPath: string;
  base: {
    id: string;
    prompt: string;
    imagePath: string;
    fileName: string;
  };
  title: string;
  style: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  aspectRatio: "1:1" | "16:9" | "9:16";
  tags: string[];
  changes: LocalAhaChange[];
  missingPromptImageIds: string[];
  missingImagePromptIds: string[];
}

interface PromptSection {
  id: string;
  prompt: string;
}

interface AnnotationFile {
  version: 1;
  changes: Record<string, {
    answerBox: NormalizedBox;
    updatedAt: string;
  }>;
}

export function resolveAhaSourceDir(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return env.AHA_SOURCE_DIR?.trim() || DEFAULT_AHA_SOURCE_DIR;
}

function parseAssetId(fileName: string) {
  return fileName.match(/^asset_([^_]+)_.*\.png$/)?.[1] ?? null;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractField(prompt: string, label: string) {
  const match = prompt.match(new RegExp(`${label}:\\s*(?:\\n| {2,}\\n)?\\s*([^\\n]+)`, "i"));
  return normalizeWhitespace(match?.[1] ?? "");
}

function normalizeDifficulty(value: string): 1 | 2 | 3 | 4 | 5 {
  const parsed = Number(value);
  return [1, 2, 3, 4, 5].includes(parsed) ? parsed as 1 | 2 | 3 | 4 | 5 : 3;
}

function normalizeAspectRatio(value: string): "1:1" | "16:9" | "9:16" {
  if (value === "16:9" || value === "9:16") {
    return value;
  }

  return "1:1";
}

function toTags(...values: string[]) {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of values.join(" ").split(/[^A-Za-z0-9]+/)) {
    const tag = value.trim().toLowerCase();
    if (tag.length < 3 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }

  return tags.slice(0, 6);
}

function summarizeEditPrompt(prompt: string) {
  const target = prompt.match(/Modify exactly one object only:\s*([^.]*)\./i)?.[1];
  if (target) {
    return normalizeWhitespace(target).slice(0, 120);
  }

  return normalizeWhitespace(prompt).slice(0, 120);
}

export function parseAhaPromptMarkdown(markdown: string): PromptSection[] {
  return markdown
    .split(/\n---\n/g)
    .map((section) => section.trim())
    .flatMap((section) => {
      const match = section.match(/^\(([^)]+)\)\s*\n([\s\S]+)$/);
      if (!match) {
        return [];
      }

      return [{
        id: match[1]!,
        prompt: match[2]!.trim(),
      }];
    });
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readThemeAnnotations(dirPath: string): Promise<AnnotationFile> {
  const annotationPath = path.join(dirPath, ANNOTATIONS_FILE);
  if (!(await pathExists(annotationPath))) {
    return {
      version: 1,
      changes: {},
    };
  }

  const parsed = JSON.parse(await readFile(annotationPath, "utf8")) as AnnotationFile;
  return {
    version: 1,
    changes: parsed.changes ?? {},
  };
}

export async function listLocalAhaAssets(
  sourceDir = resolveAhaSourceDir(),
): Promise<LocalAhaTheme[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const themes: LocalAhaTheme[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const dirPath = path.join(sourceDir, entry.name);
    const promptPath = path.join(dirPath, "prompt.md");
    if (!(await pathExists(promptPath))) {
      continue;
    }

    const files = await readdir(dirPath);
    const imageFiles = files.filter((fileName) => fileName.endsWith(".png"));
    const imageById = new Map(
      imageFiles.flatMap((fileName) => {
        const id = parseAssetId(fileName);
        return id ? [[id, fileName] as const] : [];
      }),
    );
    const sections = parseAhaPromptMarkdown(await readFile(promptPath, "utf8"));
    const baseSection = sections[0];

    if (!baseSection) {
      continue;
    }

    const baseImageFile = imageById.get(baseSection.id);
    if (!baseImageFile) {
      continue;
    }

    const annotations = await readThemeAnnotations(dirPath);
    const style = extractField(baseSection.prompt, "Selected style");
    const title = extractField(baseSection.prompt, "Selected theme") || entry.name;
    const difficulty = normalizeDifficulty(extractField(baseSection.prompt, "Target difficulty"));
    const aspectRatio = normalizeAspectRatio(extractField(baseSection.prompt, "Aspect ratio"));
    const promptChangeIds = new Set(sections.slice(1).map((section) => section.id));
    const imageIds = [...imageById.keys()];
    const changes = sections.slice(1).flatMap((section): LocalAhaChange[] => {
      const imageFile = imageById.get(section.id);
      if (!imageFile) {
        return [];
      }

      return [{
        id: section.id,
        editPrompt: section.prompt,
        changeSummary: summarizeEditPrompt(section.prompt),
        imagePath: path.join(dirPath, imageFile),
        fileName: imageFile,
        annotation: annotations.changes[section.id]?.answerBox ?? null,
      }];
    });

    themes.push({
      slug: entry.name,
      dirPath,
      base: {
        id: baseSection.id,
        prompt: baseSection.prompt,
        imagePath: path.join(dirPath, baseImageFile),
        fileName: baseImageFile,
      },
      title,
      style,
      difficulty,
      aspectRatio,
      tags: toTags("change", title, style, entry.name),
      changes,
      missingPromptImageIds: imageIds.filter((id) => id !== baseSection.id && !promptChangeIds.has(id)),
      missingImagePromptIds: [...promptChangeIds].filter((id) => !imageById.has(id)),
    });
  }

  return themes.sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function resolveLocalAhaImagePath(params: {
  sourceDir?: string;
  themeSlug: string;
  assetId: string;
}) {
  const themes = await listLocalAhaAssets(params.sourceDir);
  const theme = themes.find((candidate) => candidate.slug === params.themeSlug);
  if (!theme) {
    throw new AppError("ROUND_NOT_FOUND", "Aha theme source was not found.", false, 404);
  }

  if (theme.base.id === params.assetId) {
    return theme.base.imagePath;
  }

  const change = theme.changes.find((candidate) => candidate.id === params.assetId);
  if (!change) {
    throw new AppError("ROUND_NOT_FOUND", "Aha image source was not found.", false, 404);
  }

  return change.imagePath;
}

export async function saveAhaAnnotation(params: {
  sourceDir?: string;
  themeSlug: string;
  changeId: string;
  answerBox: NormalizedBox;
}) {
  const themes = await listLocalAhaAssets(params.sourceDir);
  const theme = themes.find((candidate) => candidate.slug === params.themeSlug);
  if (!theme) {
    throw new AppError("ROUND_NOT_FOUND", "Aha theme source was not found.", false, 404);
  }

  const change = theme.changes.find((candidate) => candidate.id === params.changeId);
  if (!change) {
    throw new AppError("ROUND_NOT_FOUND", "Aha change source was not found.", false, 404);
  }

  const annotations = await readThemeAnnotations(theme.dirPath);
  annotations.changes[params.changeId] = {
    answerBox: params.answerBox,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(theme.dirPath, { recursive: true });
  await writeFile(
    path.join(theme.dirPath, ANNOTATIONS_FILE),
    `${JSON.stringify(annotations, null, 2)}\n`,
    "utf8",
  );

  return {
    themeSlug: params.themeSlug,
    changeId: params.changeId,
    answerBox: params.answerBox,
  };
}
