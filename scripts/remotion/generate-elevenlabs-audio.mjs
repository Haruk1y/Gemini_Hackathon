import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const planPath = join(projectRoot, "src/remotion/prompdojo-elevenlabs-audio-plan.json");
const outputRoot = join(projectRoot, "public/remotion/audio/elevenlabs/promptdojo-v1");
const apiBase = "https://api.elevenlabs.io/v1";
const minAudioBytes = 512;

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = join(projectRoot, fileName);
    if (!existsSync(filePath)) continue;

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const envLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      const equalsIndex = envLine.indexOf("=");
      if (equalsIndex === -1) continue;

      const key = envLine.slice(0, equalsIndex).trim();
      let value = envLine.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/u, "").trim();
      }

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function readPlan() {
  let text;
  try {
    text = readFileSync(planPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Audio plan not found at ${relative(projectRoot, planPath)}.`);
    }
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Audio plan JSON is invalid: ${error.message}`);
  }
}

function usage() {
  return [
    "Usage: node scripts/remotion/generate-elevenlabs-audio.mjs [--dry-run | --generate] [--check] [--asset <id>...]",
    "",
    "Options:",
    "  --dry-run   Validate and print planned jobs without paid generation. Default.",
    "  --generate  Call ElevenLabs Music and Sound Generation endpoints.",
    "  --check     Validate ELEVENLABS_API_KEY with GET /v1/user.",
    "  --asset     Limit dry-run or generation to one asset id. Can be repeated.",
    "  --help      Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    check: false,
    dryRun: false,
    generate: false,
    help: false,
    assetIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--generate") {
      options.generate = true;
    } else if (arg === "--asset") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --asset.\n\n${usage()}`);
      }
      options.assetIds.push(value);
      index += 1;
    } else if (arg.startsWith("--asset=")) {
      const value = arg.slice("--asset=".length);
      if (!value) {
        throw new Error(`Missing value for --asset.\n\n${usage()}`);
      }
      options.assetIds.push(value);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  if (options.dryRun && options.generate) {
    throw new Error("Use only one of --dry-run or --generate.");
  }

  if (!options.generate) {
    options.dryRun = true;
  }

  return options;
}

function selectAssets(plan, assetIds) {
  if (assetIds.length === 0) {
    return [plan.music, ...plan.assets];
  }

  const assets = [plan.music, ...plan.assets];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const selected = [];

  for (const assetId of assetIds) {
    const asset = assetById.get(assetId);
    if (!asset) {
      throw new Error(`Unknown asset id: ${assetId}`);
    }
    if (!selected.some((item) => item.id === asset.id)) {
      selected.push(asset);
    }
  }

  return selected;
}

function requiredApiKey() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Add it to .env.local or export it before running this script.",
    );
  }
  return key;
}

function outputPathFor(plan, item) {
  const outputPath = resolve(outputRoot, safeRelativeMp3Path(item.file));
  const relativePath = relative(outputRoot, outputPath);
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Refusing unsafe output path for ${item.id}.`);
  }

  return outputPath;
}

function sidecarPathFor(audioPath) {
  const extension = extname(audioPath);
  return `${audioPath.slice(0, -extension.length)}.elevenlabs.json`;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function publicUrlFor(item) {
  return `/${item.src}`;
}

function isLocalAsset(item) {
  return item.provider === "local" || item.modelId === "local-audio";
}

function safeRelativeMp3Path(filePath) {
  const parts = String(filePath ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) =>
      part
        .normalize("NFKD")
        .replaceAll(/[^A-Za-z0-9._-]+/gu, "-")
        .replaceAll(/^-+|-+$/gu, "")
        .replaceAll(/\.{2,}/gu, "."),
    )
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("Audio plan item is missing an output file path.");
  }

  const last = parts.at(-1);
  const extension = extname(last);
  parts[parts.length - 1] =
    extension === ".mp3" ? last : `${last.slice(0, last.length - extension.length)}.mp3`;

  return parts.join("/");
}

function safeHeaders(response) {
  const names = [
    "song-id",
    "history-item-id",
    "request-id",
    "x-elevenlabs-request-id",
    "x-request-id",
    "character-cost",
    "content-type",
    "content-length",
    "date",
    "cf-ray",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ];

  return Object.fromEntries(
    names.map((name) => [name, response.headers.get(name)]).filter(([, value]) => Boolean(value)),
  );
}

function responseIds(response) {
  const names = ["song-id", "history-item-id", "request-id", "x-elevenlabs-request-id", "x-request-id"];

  return Object.fromEntries(
    names.map((name) => [name, response.headers.get(name)]).filter(([, value]) => Boolean(value)),
  );
}

async function parseError(response) {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;

  try {
    const json = JSON.parse(text);
    const detail = json.detail ?? json.message ?? json.error ?? json;
    const message = typeof detail === "string" ? detail : JSON.stringify(detail);
    return message.replace(/\s+/gu, " ").trim().slice(0, 1200);
  } catch {
    return text.replace(/\s+/gu, " ").trim().slice(0, 1200);
  }
}

async function requestAudio({ endpoint, apiKey, body, outputFormat }) {
  const url = new URL(`${apiBase}${endpoint}`);
  if (outputFormat) {
    url.searchParams.set("output_format", outputFormat);
  }

  const requestedAt = new Date().toISOString();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Network error while calling ElevenLabs ${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const detail = await parseError(response);
    const hint =
      response.status === 401 || response.status === 403
        ? `${response.status} authentication failed. Check ELEVENLABS_API_KEY and account permissions.`
        : response.status === 422
          ? "422 validation failed. Check the prompt and parameters. Avoid artist names, bands, or copyrighted lyrics."
          : response.status === 429
            ? `429 rate limited.${retryAfter ? ` Retry after ${retryAfter}s.` : ""}`
            : `ElevenLabs request failed with HTTP ${response.status}.`;

    throw new Error(`${hint} ${detail}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < minAudioBytes) {
    throw new Error(`Generated audio was unexpectedly small (${buffer.byteLength} bytes).`);
  }

  return {
    buffer,
    response,
    timestamps: {
      requestedAt,
      completedAt: new Date().toISOString(),
    },
  };
}

async function validateApiKey(apiKey) {
  let response;
  try {
    response = await fetch(`${apiBase}/user`, {
      headers: {
        "xi-api-key": apiKey,
      },
    });
  } catch (error) {
    throw new Error(
      `Network error while validating ELEVENLABS_API_KEY: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    const detail = await parseError(response);
    throw new Error(`ElevenLabs key validation failed with HTTP ${response.status}. ${detail}`);
  }

  await response.arrayBuffer().catch(() => {});
  console.log("ElevenLabs key OK.");
}

function printDryRun(plan, assets = [plan.music, ...plan.assets]) {
  const sfxSeconds = assets
    .filter((asset) => asset.kind === "sfx")
    .reduce(
      (total, asset) => total + Number(asset.durationSeconds ?? 0),
      0,
    );

  console.log(`PrompDojo ElevenLabs audio plan: ${plan.version}`);
  console.log(`Duration: ${plan.durationSeconds}s`);
  console.log(`Output root: ${relative(projectRoot, outputRoot)}`);
  console.log(
    `Assets: ${assets.length} (${Math.round(sfxSeconds * 10) / 10}s SFX${
      assets.some((asset) => asset.kind === "music") ? " + music" : ""
    })`,
  );
  console.log("");

  for (const item of assets) {
    const duration =
      item.kind === "music"
        ? `${Math.round(item.musicLengthMs / 100) / 10}s`
        : `${item.durationSeconds}s`;
    console.log(`- ${item.id} [${item.kind}${isLocalAsset(item) ? ", local" : ""}] ${duration}`);
    console.log(`  file: ${relative(projectRoot, outputPathFor(plan, item))}`);
    console.log(`  model: ${item.modelId}, format: ${item.outputFormat}`);
    console.log(`  prompt: ${item.prompt}`);
  }

  console.log("");
  console.log(`Cues: ${plan.cues.length}`);
  for (const cue of plan.cues) {
    console.log(
      `- ${cue.id.padEnd(28)} ${String(cue.at).padStart(5)}s  ${cue.assetId}  vol=${cue.volume}`,
    );
  }
}

async function generateMusic(plan, apiKey) {
  const item = plan.music;
  console.log(`Generating music: ${item.id}`);
  const { buffer, response, timestamps } = await requestAudio({
    endpoint: "/music",
    apiKey,
    outputFormat: item.outputFormat,
    body: {
      prompt: item.prompt,
      music_length_ms: item.musicLengthMs,
      model_id: item.modelId,
      force_instrumental: item.forceInstrumental,
    },
  });

  writeGeneratedAsset(plan, item, buffer, response, {
    musicLengthMs: item.musicLengthMs,
    forceInstrumental: item.forceInstrumental,
    timestamps,
  });
}

async function generateSoundEffect(plan, item, apiKey) {
  console.log(`Generating SFX: ${item.id}`);
  const { buffer, response, timestamps } = await requestAudio({
    endpoint: "/sound-generation",
    apiKey,
    outputFormat: item.outputFormat,
    body: {
      text: item.prompt,
      model_id: item.modelId,
      duration_seconds: item.durationSeconds,
      prompt_influence: item.promptInfluence,
      loop: Boolean(item.loop),
    },
  });

  writeGeneratedAsset(plan, item, buffer, response, {
    durationSeconds: item.durationSeconds,
    promptInfluence: item.promptInfluence,
    loop: Boolean(item.loop),
    timestamps,
  });
}

function writeGeneratedAsset(plan, item, buffer, response, request) {
  const outputPath = outputPathFor(plan, item);
  const metadataPath = sidecarPathFor(outputPath);
  const checksum = sha256(buffer);
  const { timestamps, ...requestDetails } = request;

  const metadata = {
    provider: "elevenlabs",
    sourceUrl:
      item.kind === "music"
        ? "https://api.elevenlabs.io/v1/music"
        : "https://api.elevenlabs.io/v1/sound-generation",
    licenseNote:
      "Generated with ElevenLabs for the PrompDojo Remotion intro. Confirm account plan and project usage rights before final public release.",
    planVersion: plan.version,
    id: item.id,
    kind: item.kind,
    label: item.label,
    model: item.modelId,
    modelId: item.modelId,
    prompt: item.prompt,
    duration:
      item.kind === "music" ? Number(item.musicLengthMs ?? 0) / 1000 : item.durationSeconds,
    outputFormat: item.outputFormat,
    timestamps,
    checksum: {
      algorithm: "sha256",
      value: checksum,
      bytes: buffer.byteLength,
    },
    request: requestDetails,
    publicPath: item.src,
    publicUrl: publicUrlFor(item),
    file: item.file,
    bytes: buffer.byteLength,
    sha256: checksum,
    generatedAt: timestamps?.completedAt,
    response: {
      status: response.status,
      ids: responseIds(response),
      headers: safeHeaders(response),
    },
  };

  atomicWriteFile(outputPath, buffer);
  atomicWriteFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${metadataPath}`);
}

function atomicWriteFile(outputPath, contents) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    writeFileSync(tmpPath, contents);
    renameSync(tmpPath, outputPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

async function generateAll(plan, apiKey, { validateKey = true, assetIds = [] } = {}) {
  if (validateKey) {
    await validateApiKey(apiKey);
  }

  for (const item of selectAssets(plan, assetIds)) {
    if (isLocalAsset(item)) {
      console.log(`Skipping local asset: ${item.id}`);
      continue;
    }

    if (item.kind === "music") {
      await generateMusic(plan, apiKey);
    } else {
      await generateSoundEffect(plan, item, apiKey);
    }
  }
}

async function main() {
  loadLocalEnv();

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const plan = readPlan();
  const selectedAssets = selectAssets(plan, options.assetIds);
  const needsRemoteGeneration =
    options.generate && selectedAssets.some((asset) => !isLocalAsset(asset));
  const apiKey = options.check || needsRemoteGeneration ? requiredApiKey() : null;

  if (options.check) {
    await validateApiKey(apiKey);
    if (!options.generate && process.argv.slice(2).every((arg) => arg === "--check")) {
      return;
    }
  }

  if (options.dryRun) {
    printDryRun(plan, selectedAssets);
    return;
  }

  await generateAll(plan, apiKey, {
    validateKey: !options.check && needsRemoteGeneration,
    assetIds: options.assetIds,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
