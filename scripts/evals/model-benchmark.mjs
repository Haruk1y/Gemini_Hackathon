import { GoogleGenAI } from "@google/genai";
import { GoogleAuth } from "google-auth-library";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

loadEnvFile(path.join(projectRoot, ".env.local"));
loadEnvFile(path.join(projectRoot, ".env"));

const GM_PROMPT_SCHEMA = z.object({
  title: z.string().min(3).max(80),
  difficulty: z.number().int().min(1).max(5),
  tags: z.array(z.string().min(1)).min(2).max(6),
  prompt: z.string().min(30).max(500),
  negativePrompt: z.string().max(300).optional(),
  mustInclude: z.array(z.string().min(1)).max(5).default([]),
  mustAvoid: z.array(z.string().min(1)).max(5).default([]),
});

const VISUAL_SCORE_SCHEMA = z.object({
  score: z.number().int().min(0).max(100),
  matchedElements: z.array(z.string().min(1)).max(6).default([]),
  missingElements: z.array(z.string().min(1)).max(6).default([]),
  note: z.string().max(240).default(""),
});

const GM_STYLE_PRESETS = [
  {
    id: "flat-poster",
    label: "flat poster",
    promptStyle: "flat poster illustration with clear silhouettes",
    texture: "clean layered shapes and minimal surface detail",
    palette: "bold but controlled color blocking",
  },
  {
    id: "paper-cut-collage",
    label: "paper cut collage",
    promptStyle: "paper cut collage illustration",
    texture: "layered cut-paper edges and simple handcrafted texture",
    palette: "playful matte colors with strong shape contrast",
  },
  {
    id: "storybook-gouache",
    label: "soft gouache storybook",
    promptStyle: "storybook gouache illustration",
    texture: "soft brush texture with rounded forms",
    palette: "gentle but readable color harmony",
  },
  {
    id: "risograph-print",
    label: "risograph print",
    promptStyle: "risograph print poster illustration",
    texture: "light print grain and simplified ink overlap",
    palette: "limited spot-color palette with strong contrast",
  },
  {
    id: "clay-diorama",
    label: "clay diorama",
    promptStyle: "small clay diorama illustration",
    texture: "soft sculpted forms with tactile handmade surfaces",
    palette: "friendly toy-like colors with clear separation",
  },
  {
    id: "ink-line-drawing",
    label: "ink line drawing",
    promptStyle: "expressive ink line drawing with flat fills",
    texture: "visible linework and sparse shading",
    palette: "restrained palette with one or two accent colors",
  },
];

const IMAGE_FIXTURES = [
  {
    id: "scones",
    label: "blueberry scones",
    url: "https://storage.googleapis.com/generativeai-downloads/images/scones.jpg",
  },
  {
    id: "cat",
    label: "orange cat",
    url: "https://storage.googleapis.com/generativeai-downloads/images/cat.jpg",
  },
  {
    id: "jetpack",
    label: "jetpack illustration",
    url: "https://storage.googleapis.com/generativeai-downloads/images/jetpack.jpg",
  },
];

const BASELINE_TEXT_MODEL = process.env.MODEL_EVAL_BASELINE_TEXT_MODEL ?? "gemini-2.5-flash";
const CANDIDATE_TEXT_MODEL =
  process.env.MODEL_EVAL_CANDIDATE_TEXT_MODEL ?? "gemini-2.5-flash-lite";
const BASELINE_JUDGE_MODEL = process.env.MODEL_EVAL_BASELINE_JUDGE_MODEL ?? BASELINE_TEXT_MODEL;
const CANDIDATE_JUDGE_MODEL =
  process.env.MODEL_EVAL_CANDIDATE_JUDGE_MODEL ?? CANDIDATE_TEXT_MODEL;
const CLAUDE_MODEL = process.env.MODEL_EVAL_CLAUDE_MODEL ?? "claude-3-5-haiku@20241022";
const GEMINI_LOCATION = process.env.MODEL_EVAL_GEMINI_LOCATION ?? "global";
const CLAUDE_LOCATION = process.env.MODEL_EVAL_CLAUDE_LOCATION ?? "us-east5";
const DEFAULT_LANGUAGE = "en";
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.MODEL_EVAL_REQUEST_TIMEOUT_MS ?? "45000",
  10,
);

const args = parseArgs(process.argv.slice(2));
const includeClaude = args.includeClaude || process.env.MODEL_EVAL_INCLUDE_CLAUDE === "true";
const smokeMode = args.smoke;
const outputPath = args.output
  ? path.resolve(projectRoot, args.output)
  : null;

async function main() {
  const projectId = resolveProjectId();
  const geminiClient = new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location: GEMINI_LOCATION,
  });

  const gmCases = buildGmCases(smokeMode);
  const preparedFixtures = await prepareImageFixtures();
  const judgeCases = buildJudgeCases(preparedFixtures, smokeMode);

  console.log(
    [
      "Running model benchmark...",
      `project=${projectId}`,
      `geminiLocation=${GEMINI_LOCATION}`,
      `gmCases=${gmCases.length}`,
      `judgeCases=${judgeCases.length}`,
      `includeClaude=${includeClaude}`,
    ].join(" "),
  );

  const gmBaseline = await runGeminiTextBenchmark({
    client: geminiClient,
    model: BASELINE_TEXT_MODEL,
    cases: gmCases,
  });
  const gmCandidate = await runGeminiTextBenchmark({
    client: geminiClient,
    model: CANDIDATE_TEXT_MODEL,
    cases: gmCases,
  });
  const judgeBaseline = await runGeminiJudgeBenchmark({
    client: geminiClient,
    model: BASELINE_JUDGE_MODEL,
    cases: judgeCases,
  });
  const judgeCandidate = await runGeminiJudgeBenchmark({
    client: geminiClient,
    model: CANDIDATE_JUDGE_MODEL,
    cases: judgeCases,
  });
  const claude = includeClaude
    ? await runClaudeTextBenchmark({
        projectId,
        location: CLAUDE_LOCATION,
        model: CLAUDE_MODEL,
        cases: gmCases,
      })
    : await probeClaudeAccess({
        projectId,
        location: CLAUDE_LOCATION,
        model: CLAUDE_MODEL,
        sampleCase: gmCases[0],
      });

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      projectId,
      geminiLocation: GEMINI_LOCATION,
      claudeLocation: CLAUDE_LOCATION,
      smokeMode,
      gmCaseCount: gmCases.length,
      judgeCaseCount: judgeCases.length,
      textModels: {
        baseline: BASELINE_TEXT_MODEL,
        candidate: CANDIDATE_TEXT_MODEL,
      },
      judgeModels: {
        baseline: BASELINE_JUDGE_MODEL,
        candidate: CANDIDATE_JUDGE_MODEL,
      },
      claudeModel: CLAUDE_MODEL,
      includeClaude,
    },
    gmPrompt: {
      baseline: summarizeTextBenchmark(gmBaseline),
      candidate: summarizeTextBenchmark(gmCandidate),
      recommendation:
        summarizeTextBenchmark(gmCandidate).successRate.numerator === gmCases.length &&
        summarizeTextBenchmark(gmCandidate).latencyMs.p50 <
          summarizeTextBenchmark(gmBaseline).latencyMs.p50
          ? "flash-lite looks promising for prompt generation, but review prompt quality before switching."
          : "keep flash until prompt quality is manually reviewed.",
    },
    judge: {
      baseline: summarizeJudgeBenchmark(judgeBaseline),
      candidate: summarizeJudgeBenchmark(judgeCandidate),
      recommendation:
        summarizeJudgeBenchmark(judgeCandidate).ordering.sameVsDifferent &&
        summarizeJudgeBenchmark(judgeCandidate).latencyMs.p50 <
          summarizeJudgeBenchmark(judgeBaseline).latencyMs.p50
          ? "flash-lite is a strong judge candidate."
          : "keep flash until judge sanity is rechecked.",
    },
    claude,
  };

  printHumanSummary(summary);
  console.log(JSON.stringify(summary, null, 2));

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`Saved summary to ${outputPath}`);
  }
}

function parseArgs(argv) {
  const parsed = {
    includeClaude: false,
    smoke: false,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--include-claude") {
      parsed.includeClaude = true;
      continue;
    }
    if (value === "--smoke") {
      parsed.smoke = true;
      continue;
    }
    if (value === "--output") {
      parsed.output = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return parsed;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function runCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

function resolveProjectId() {
  const candidate =
    process.env.MODEL_EVAL_GCP_PROJECT_ID ??
    process.env.VERTEX_PROJECT_ID ??
    runCommand("gcloud", ["config", "get-value", "project"]) ??
    process.env.GCP_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT;

  if (!candidate) {
    throw new Error(
      "Could not resolve a GCP project. Set GCP_PROJECT_ID or run `gcloud config set project ...`.",
    );
  }

  if (/^\d+$/u.test(candidate)) {
    return (
      runCommand("gcloud", ["projects", "describe", candidate, "--format=value(projectId)"]) ??
      candidate
    );
  }

  return candidate;
}

function buildGmCases(smoke) {
  const aspectRatios = smoke ? ["1:1"] : ["1:1", "16:9"];

  return GM_STYLE_PRESETS.flatMap((stylePreset) =>
    aspectRatios.map((aspectRatio) => ({
      id: `${stylePreset.id}-${aspectRatio.replace(":", "x")}`,
      aspectRatio,
      stylePreset,
    })),
  );
}

async function prepareImageFixtures() {
  const cacheDir = path.join(os.tmpdir(), "gemini-hackathon-model-eval");
  await mkdir(cacheDir, { recursive: true });

  const fixtures = [];

  for (const source of IMAGE_FIXTURES) {
    const original = await downloadImageFixture(source, cacheDir);
    const near = await createNearVariantIfPossible(original, cacheDir);
    fixtures.push({
      ...original,
      near,
    });
  }

  return fixtures;
}

async function downloadImageFixture(source, cacheDir) {
  const extension = path.extname(new URL(source.url).pathname) || ".jpg";
  const cachePath = path.join(cacheDir, `${source.id}${extension}`);

  if (!existsSync(cachePath)) {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to download ${source.url}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(cachePath, Buffer.from(arrayBuffer));
  }

  const buffer = await readFile(cachePath);
  const mimeType = mimeTypeFromExtension(extension);

  return {
    id: source.id,
    label: source.label,
    path: cachePath,
    mimeType,
    base64Data: buffer.toString("base64"),
  };
}

async function createNearVariantIfPossible(fixture, cacheDir) {
  if (process.platform !== "darwin") {
    return null;
  }

  const nearPath = path.join(
    cacheDir,
    `${fixture.id}-near${path.extname(fixture.path) || ".jpg"}`,
  );

  if (!existsSync(nearPath)) {
    const result = spawnSync(
      "sips",
      ["-Z", "384", fixture.path, "--out", nearPath],
      { encoding: "utf8" },
    );

    if (result.status !== 0 || !existsSync(nearPath)) {
      return null;
    }
  }

  const buffer = await readFile(nearPath);
  return {
    id: `${fixture.id}-near`,
    label: `${fixture.label} resized`,
    path: nearPath,
    mimeType: fixture.mimeType,
    base64Data: buffer.toString("base64"),
  };
}

function buildJudgeCases(fixtures, smoke) {
  const cases = fixtures.map((fixture) => ({
    id: `${fixture.id}-same`,
    bucket: "same",
    target: fixture,
    attempt: fixture,
  }));

  for (const fixture of fixtures) {
    if (!fixture.near) {
      continue;
    }
    cases.push({
      id: `${fixture.id}-near`,
      bucket: "near",
      target: fixture,
      attempt: fixture.near,
    });
  }

  const differentPairs = [
    [fixtures[0], fixtures[1]],
    [fixtures[0], fixtures[2]],
    [fixtures[1], fixtures[2]],
  ].filter((pair) => pair.every(Boolean));

  for (const [left, right] of differentPairs) {
    cases.push({
      id: `${left.id}-vs-${right.id}`,
      bucket: "different",
      target: left,
      attempt: right,
    });
  }

  if (smoke) {
    return cases.filter((item) => item.bucket !== "near").slice(0, 6);
  }

  return cases;
}

async function runGeminiTextBenchmark({ client, model, cases }) {
  const results = [];

  for (const benchmarkCase of cases) {
    const startedAt = performance.now();
    try {
      const response = await withTimeout(
        client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: gmSystemPrompt(benchmarkCase.aspectRatio, benchmarkCase.stylePreset) },
                {
                  text: gmStructuredUserPrompt(
                    benchmarkCase.aspectRatio,
                    benchmarkCase.stylePreset,
                  ),
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: z.toJSONSchema(GM_PROMPT_SCHEMA),
          },
        }),
        REQUEST_TIMEOUT_MS,
        `Gemini text request timed out for ${benchmarkCase.id}`,
      );

      const elapsedMs = Math.round(performance.now() - startedAt);
      const text = responseText(response);
      const parsed = text ? parseStructuredText(GM_PROMPT_SCHEMA, text, coerceGmPromptCandidate) : null;

      results.push({
        caseId: benchmarkCase.id,
        aspectRatio: benchmarkCase.aspectRatio,
        stylePresetId: benchmarkCase.stylePreset.id,
        elapsedMs,
        ok: Boolean(parsed),
        output: parsed,
        rawText: parsed ? null : text,
      });
    } catch (error) {
      results.push({
        caseId: benchmarkCase.id,
        aspectRatio: benchmarkCase.aspectRatio,
        stylePresetId: benchmarkCase.stylePreset.id,
        elapsedMs: Math.round(performance.now() - startedAt),
        ok: false,
        output: null,
        rawText: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    model,
    results,
  };
}

async function runGeminiJudgeBenchmark({ client, model, cases }) {
  const results = [];

  for (const benchmarkCase of cases) {
    const startedAt = performance.now();

    try {
      const response = await withTimeout(
        client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "Compare these two images and score their visual similarity from 0 to 100.",
                },
                { text: "The first image is the target image." },
                {
                  inlineData: {
                    data: benchmarkCase.target.base64Data,
                    mimeType: benchmarkCase.target.mimeType,
                  },
                },
                { text: "The second image is the player's generated answer image." },
                {
                  inlineData: {
                    data: benchmarkCase.attempt.base64Data,
                    mimeType: benchmarkCase.attempt.mimeType,
                  },
                },
                { text: visualJudgePrompt(DEFAULT_LANGUAGE) },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: z.toJSONSchema(VISUAL_SCORE_SCHEMA),
          },
        }),
        REQUEST_TIMEOUT_MS,
        `Gemini judge request timed out for ${benchmarkCase.id}`,
      );

      const elapsedMs = Math.round(performance.now() - startedAt);
      const text = responseText(response);
      const parsed = text
        ? parseStructuredText(VISUAL_SCORE_SCHEMA, text, coerceVisualScoreCandidate)
        : null;

      results.push({
        caseId: benchmarkCase.id,
        bucket: benchmarkCase.bucket,
        elapsedMs,
        ok: Boolean(parsed),
        output: parsed,
        rawText: parsed ? null : text,
      });
    } catch (error) {
      results.push({
        caseId: benchmarkCase.id,
        bucket: benchmarkCase.bucket,
        elapsedMs: Math.round(performance.now() - startedAt),
        ok: false,
        output: null,
        rawText: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    model,
    results,
  };
}

async function probeClaudeAccess({ projectId, location, model, sampleCase }) {
  const probe = await runClaudeTextRequest({
    projectId,
    location,
    model,
    benchmarkCase: sampleCase,
  });

  if (probe.ok) {
    return {
      model,
      location,
      access: "available",
      note: "Claude access looks available. Re-run with --include-claude for the full text benchmark.",
      sample: probe.output,
      latencyMs: probe.elapsedMs,
    };
  }

  return {
    model,
    location,
    access: "blocked",
    note: probe.error,
  };
}

async function runClaudeTextBenchmark({ projectId, location, model, cases }) {
  const results = [];

  for (const benchmarkCase of cases) {
    const result = await runClaudeTextRequest({
      projectId,
      location,
      model,
      benchmarkCase,
    });
    results.push(result);

    if (!result.ok && /not found|does not have access|permission/i.test(result.error ?? "")) {
      break;
    }
  }

  const blockedResult = results.find((result) => !result.ok);
  if (blockedResult && /not found|does not have access|permission/i.test(blockedResult.error ?? "")) {
    return {
      model,
      location,
      access: "blocked",
      note: blockedResult.error,
    };
  }

  return {
    model,
    location,
    access: "available",
    benchmark: summarizeTextBenchmark({
      model,
      results,
    }),
  };
}

async function runClaudeTextRequest({ projectId, location, model, benchmarkCase }) {
  const startedAt = performance.now();

  try {
    const authorization = await getGoogleAuthorizationHeader();
    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}` +
      `/locations/${location}/publishers/anthropic/models/${model}:rawPredict`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  gmSystemPrompt(benchmarkCase.aspectRatio, benchmarkCase.stylePreset),
                  gmStructuredUserPrompt(benchmarkCase.aspectRatio, benchmarkCase.stylePreset),
                  "Return JSON only.",
                ].join("\n\n"),
              },
            ],
          },
        ],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return {
        caseId: benchmarkCase.id,
        ok: false,
        elapsedMs: Math.round(performance.now() - startedAt),
        error:
          payload?.error?.message ??
          payload?.message ??
          `${response.status} ${response.statusText}`,
      };
    }

    const text = extractClaudeText(payload);
    const parsed = text
      ? parseStructuredText(GM_PROMPT_SCHEMA, text, coerceGmPromptCandidate)
      : null;
    return {
      caseId: benchmarkCase.id,
      ok: Boolean(parsed),
      elapsedMs: Math.round(performance.now() - startedAt),
      output: parsed,
      rawText: parsed ? null : text,
      error: parsed ? null : "Claude returned non-parseable structured output.",
    };
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      ok: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getGoogleAuthorizationHeader() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token =
    typeof accessToken === "string" ? accessToken : accessToken?.token ?? null;
  const authorization = token ? `Bearer ${token}` : null;

  if (!authorization) {
    throw new Error(
      "Could not resolve an ADC authorization header. Run `gcloud auth application-default login` first.",
    );
  }

  return authorization;
}

function extractClaudeText(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const textBlocks = blocks.filter((block) => block?.type === "text");
  return textBlocks.map((block) => block.text).filter(Boolean).join("\n").trim() || null;
}

function summarizeTextBenchmark(benchmark) {
  const successful = benchmark.results.filter((item) => item.ok);
  const latencies = successful.map((item) => item.elapsedMs);

  return {
    model: benchmark.model,
    caseCount: benchmark.results.length,
    successRate: fraction(successful.length, benchmark.results.length),
    latencyMs: summarizeNumbers(latencies),
    failures: benchmark.results
      .filter((item) => !item.ok)
      .map((item) => ({
        caseId: item.caseId,
        error: item.error ?? "Structured output parse failed",
      })),
    samples: successful.slice(0, 4).map((item) => ({
      caseId: item.caseId,
      title: item.output?.title ?? null,
      difficulty: item.output?.difficulty ?? null,
      tags: item.output?.tags ?? [],
      prompt: item.output?.prompt ?? null,
      elapsedMs: item.elapsedMs,
    })),
  };
}

function summarizeJudgeBenchmark(benchmark) {
  const successful = benchmark.results.filter((item) => item.ok);
  const latencies = successful.map((item) => item.elapsedMs);
  const scoresByBucket = groupScoresByBucket(successful);
  const sameMedian = median(scoresByBucket.same);
  const nearMedian = median(scoresByBucket.near);
  const differentMedian = median(scoresByBucket.different);

  return {
    model: benchmark.model,
    caseCount: benchmark.results.length,
    successRate: fraction(successful.length, benchmark.results.length),
    latencyMs: summarizeNumbers(latencies),
    scoreSummary: {
      same: summarizeNumbers(scoresByBucket.same),
      near: summarizeNumbers(scoresByBucket.near),
      different: summarizeNumbers(scoresByBucket.different),
    },
    ordering: {
      sameVsDifferent:
        sameMedian !== null && differentMedian !== null ? sameMedian > differentMedian : null,
      nearVsDifferent:
        nearMedian !== null && differentMedian !== null ? nearMedian > differentMedian : null,
      sameVsNear: sameMedian !== null && nearMedian !== null ? sameMedian >= nearMedian : null,
    },
    failures: benchmark.results
      .filter((item) => !item.ok)
      .map((item) => ({
        caseId: item.caseId,
        error: item.error ?? "Structured output parse failed",
      })),
    samples: successful.slice(0, 6).map((item) => ({
      caseId: item.caseId,
      bucket: item.bucket,
      score: item.output?.score ?? null,
      matchedElements: item.output?.matchedElements ?? [],
      missingElements: item.output?.missingElements ?? [],
      note: item.output?.note ?? null,
      elapsedMs: item.elapsedMs,
    })),
  };
}

function groupScoresByBucket(results) {
  return {
    same: results.filter((item) => item.bucket === "same").map((item) => item.output.score),
    near: results.filter((item) => item.bucket === "near").map((item) => item.output.score),
    different: results
      .filter((item) => item.bucket === "different")
      .map((item) => item.output.score),
  };
}

function summarizeNumbers(values) {
  if (!values || values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
      p50: null,
      p95: null,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const avg = Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedValues, fractionValue) {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fractionValue) - 1),
  );
  return sortedValues[index];
}

function median(values) {
  if (!values || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return percentile(sorted, 0.5);
}

function fraction(numerator, denominator) {
  return {
    numerator,
    denominator,
    label: `${numerator}/${denominator}`,
  };
}

function responseText(response) {
  if (typeof response?.text === "string" && response.text.trim()) {
    return response.text.trim();
  }

  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return null;
}

function parseStructuredText(schema, text, coerce) {
  for (const payload of parseJsonPayloads(text)) {
    for (const candidate of buildStructuredCandidates(payload)) {
      const parsed = schema.safeParse(candidate);
      if (parsed.success) {
        return parsed.data;
      }

      const normalized = coerce?.(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

function buildStructuredCandidates(parsed) {
  const candidates = [];
  const queue = [parsed];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    candidates.push(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const wrappedKeys = ["data", "result", "output", "response", "value", "candidate", "content"];
    for (const key of wrappedKeys) {
      const nested = current[key];
      if (nested) {
        queue.push(nested);
      }
    }
  }

  return candidates;
}

function parseJsonPayloads(text) {
  const candidates = [];
  const trimmed = text.trim();

  pushCandidate(candidates, trimmed);

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  pushCandidate(candidates, fencedMatch?.[1]);

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    pushCandidate(candidates, trimmed.slice(objectStart, objectEnd + 1));
  }

  return candidates.flatMap((candidate) => {
    try {
      return [JSON.parse(candidate)];
    } catch {
      return [];
    }
  });
}

function pushCandidate(candidates, value) {
  const next = value?.trim();
  if (!next || candidates.includes(next)) {
    return;
  }
  candidates.push(next);
}

function asRecord(value) {
  return value && typeof value === "object" ? value : null;
}

function normalizeText(value, maxLength) {
  return value
    .replace(/\s+/gu, " ")
    .replace(/^[`"'“”]+|[`"'“”]+$/gu, "")
    .trim()
    .slice(0, maxLength);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeText(value, 80);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function coerceStringList(value, maxItems) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.filter((item) => typeof item === "string")).slice(0, maxItems);
  }

  if (typeof value === "string") {
    return uniqueStrings(
      value
        .split(/\n|,|\/|\u2022|・/gu)
        .map((part) => part.trim())
        .filter(Boolean),
    ).slice(0, maxItems);
  }

  return [];
}

function deriveTitleFromPrompt(prompt) {
  const segment = prompt.split(/[.!?。]/u)[0]?.split(/,|、/u)[0] ?? prompt;
  const normalized = normalizeText(segment, 80);
  return normalized.length >= 3 ? normalized : "Generated Challenge";
}

function coerceGmPromptCandidate(candidate) {
  const record = asRecord(candidate);
  if (!record) {
    return null;
  }

  const prompt =
    typeof record.prompt === "string"
      ? normalizeText(record.prompt, 500)
      : typeof record.text === "string"
        ? normalizeText(record.text, 500)
        : null;

  if (!prompt || prompt.length < 30) {
    return null;
  }

  const rawDifficulty = record.difficulty;
  const difficulty =
    typeof rawDifficulty === "number"
      ? Math.round(rawDifficulty)
      : typeof rawDifficulty === "string"
        ? Math.round(Number.parseFloat(rawDifficulty))
        : 3;

  const normalized = {
    title:
      typeof record.title === "string"
        ? normalizeText(record.title, 80)
        : deriveTitleFromPrompt(prompt),
    difficulty:
      Number.isFinite(difficulty) && difficulty >= 1 && difficulty <= 5 ? difficulty : 3,
    tags: coerceStringList(record.tags, 6),
    prompt,
    negativePrompt:
      typeof record.negativePrompt === "string"
        ? normalizeText(record.negativePrompt, 300)
        : undefined,
    mustInclude: coerceStringList(record.mustInclude, 5),
    mustAvoid: coerceStringList(record.mustAvoid, 5),
  };

  if (normalized.tags.length < 2) {
    normalized.tags = uniqueStrings(
      prompt
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/gu)
        .filter(Boolean)
        .filter((token) => token.length > 2),
    ).slice(0, 6);
  }

  const parsed = GM_PROMPT_SCHEMA.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function coerceVisualScoreCandidate(candidate) {
  const record = asRecord(candidate);
  if (!record) {
    return null;
  }

  const rawScore = record.score;
  const score =
    typeof rawScore === "number"
      ? Math.round(rawScore)
      : typeof rawScore === "string"
        ? Math.round(Number.parseFloat(rawScore))
        : Number.NaN;

  if (!Number.isFinite(score)) {
    return null;
  }

  const normalized = {
    score: Math.min(100, Math.max(0, score)),
    matchedElements: coerceStringList(record.matchedElements, 6),
    missingElements: coerceStringList(record.missingElements, 6),
    note: typeof record.note === "string" ? normalizeText(record.note, 240) : "",
  };

  const parsed = VISUAL_SCORE_SCHEMA.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function gmSystemPrompt(aspectRatio, stylePreset) {
  return [
    "あなたは画像生成ゲームのゲームマスターです。",
    `今回の画風テーマは "${stylePreset.label}" です。`,
    "毎回同じビビッドなステッカー調に寄らず、指定された画風で遊び心のあるお題を作成してください。",
    "著作権リスクを避けるため、有名キャラクター、ロゴ、実在ブランド文字列は避けてください。",
    "出力は画像生成に使う英語プロンプトを中心に組み立ててください。",
    "構図は複雑にしすぎず、主役は1つ、重要小物は2〜3個、背景は1シーンまでに抑えてください。",
    "photoreal すぎる描写、群衆、細かすぎる情報量、文字要素は避けてください。",
    `出力はアスペクト比 ${aspectRatio} を想定した内容にしてください。`,
  ].join("\n");
}

function gmStructuredUserPrompt(aspectRatio, stylePreset) {
  return [
    `アスペクト比 ${aspectRatio} で生成しやすいお題を1つ作成。`,
    "被写体、背景、行動、構図、光、色、質感を具体化する。",
    "テキストは画像内に入れない。",
    `画風は ${stylePreset.label} に固定する。`,
    `スタイル表現には "${stylePreset.promptStyle}", "${stylePreset.texture}", "${stylePreset.palette}" を反映する。`,
    "ひと目でテーマが伝わる具体的な1シーンにする。",
    "主役は1つ、重要小物は2〜3個まで、背景はシンプルに保つ。",
    "以下の JSON schema に従って返す。",
    "title: short English challenge title.",
    "difficulty: integer from 1 to 5.",
    "tags: 2 to 6 short English tags.",
    "prompt: one polished English image-generation prompt.",
    "negativePrompt: optional negative prompt.",
    "mustInclude / mustAvoid: optional short lists.",
    "Return JSON only.",
  ].join("\n");
}

function visualJudgePrompt(language) {
  return [
    "Scoring rubric: subject 35, composition 20, colors 15, background/props 20, style 10.",
    "Return at most 6 matchedElements and at most 6 missingElements.",
    `Write matchedElements, missingElements, and note in ${
      language === "ja" ? "Japanese" : "English"
    }.`,
    "Return JSON only, and make score an integer.",
  ].join("\n");
}

function mimeTypeFromExtension(extension) {
  const normalized = extension.toLowerCase();
  if (normalized === ".png") {
    return "image/png";
  }
  if (normalized === ".webp") {
    return "image/webp";
  }
  return "image/jpeg";
}

function printHumanSummary(summary) {
  const gmBaseline = summary.gmPrompt.baseline;
  const gmCandidate = summary.gmPrompt.candidate;
  const judgeBaseline = summary.judge.baseline;
  const judgeCandidate = summary.judge.candidate;

  console.log("");
  console.log("Text benchmark");
  console.log(
    `- ${gmBaseline.model}: ${gmBaseline.successRate.label} schema success, p50 ${gmBaseline.latencyMs.p50}ms, p95 ${gmBaseline.latencyMs.p95}ms`,
  );
  console.log(
    `- ${gmCandidate.model}: ${gmCandidate.successRate.label} schema success, p50 ${gmCandidate.latencyMs.p50}ms, p95 ${gmCandidate.latencyMs.p95}ms`,
  );
  console.log("");
  console.log("Judge benchmark");
  console.log(
    `- ${judgeBaseline.model}: ${judgeBaseline.successRate.label} schema success, p50 ${judgeBaseline.latencyMs.p50}ms, same median ${judgeBaseline.scoreSummary.same.p50}, near median ${judgeBaseline.scoreSummary.near.p50}, different median ${judgeBaseline.scoreSummary.different.p50}`,
  );
  console.log(
    `- ${judgeCandidate.model}: ${judgeCandidate.successRate.label} schema success, p50 ${judgeCandidate.latencyMs.p50}ms, same median ${judgeCandidate.scoreSummary.same.p50}, near median ${judgeCandidate.scoreSummary.near.p50}, different median ${judgeCandidate.scoreSummary.different.p50}`,
  );
  console.log("");
  console.log("Claude");
  console.log(
    `- ${summary.claude.model}: ${summary.claude.access ?? "not-run"}${summary.claude.note ? ` (${summary.claude.note})` : ""}`,
  );
  console.log("");
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
