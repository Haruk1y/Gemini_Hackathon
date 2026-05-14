import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  FileAudio,
  ListMusic,
  Music2,
  Volume2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import rawAudioPlan from "@/remotion/prompdojo-elevenlabs-audio-plan.json";
import { cn } from "@/lib/utils/cn";

interface BaseAudioAsset {
  id: string;
  label: string;
  src: string;
  file: string;
  modelId: string;
  outputFormat: string;
  prompt: string;
  provider?: string;
  sourceFile?: string;
}

interface MusicAudioAsset extends BaseAudioAsset {
  kind: "music";
  musicLengthMs: number;
  forceInstrumental: boolean;
}

interface SfxAudioAsset extends BaseAudioAsset {
  kind: "sfx";
  durationSeconds: number;
  promptInfluence: number;
}

type AudioAsset = MusicAudioAsset | SfxAudioAsset;

interface AudioCue {
  id: string;
  assetId: string;
  at: number;
  volume: number;
  durationSeconds?: number;
  playbackRate?: number;
  trimStartSeconds?: number;
}

interface AudioPlan {
  version: string;
  basePublicPath: string;
  baseFilePath: string;
  durationSeconds: number;
  music: MusicAudioAsset;
  assets: SfxAudioAsset[];
  cues: AudioCue[];
}

interface AudioMetadata {
  checksum?: string | { value?: string };
  sha256?: string;
  bytes?: number;
  generatedAt?: string;
  responseHeaders?: Record<string, string>;
  licenseNote?: string;
}

interface AssetViewModel {
  asset: AudioAsset;
  cues: AudioCue[];
  audioExists: boolean;
  metadataExists: boolean;
  metadata: AudioMetadata | null;
  relativeFile: string;
  publicUrl: string;
}

const audioPlan = rawAudioPlan as AudioPlan;

function assetPublicUrl(asset: AudioAsset) {
  return `/${asset.src}`;
}

function sidecarPathFor(filePath: string) {
  const extension = extname(filePath);
  return `${filePath.slice(0, -extension.length)}.elevenlabs.json`;
}

function readMetadata(filePath: string): AudioMetadata | null {
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as AudioMetadata;
  } catch {
    return null;
  }
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

function formatDuration(asset: AudioAsset) {
  if (asset.kind === "music") {
    return `${Math.round(asset.musicLengthMs / 100) / 10}s`;
  }

  return `${asset.durationSeconds}s`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "unknown size";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function metadataChecksum(metadata: AudioMetadata | null) {
  if (!metadata) return null;
  if (typeof metadata.checksum === "string") return metadata.checksum;
  if (typeof metadata.checksum?.value === "string") {
    return metadata.checksum.value;
  }

  return metadata.sha256 ?? null;
}

function buildAssets(): AssetViewModel[] {
  const projectRoot = process.cwd();
  const assets: AudioAsset[] = [audioPlan.music, ...audioPlan.assets];

  return assets.map((asset) => {
    const audioPath = join(projectRoot, audioPlan.baseFilePath, asset.file);
    const metadataPath = sidecarPathFor(audioPath);
    const metadata = readMetadata(metadataPath);

    return {
      asset,
      cues: audioPlan.cues.filter((cue) => cue.assetId === asset.id),
      audioExists: existsSync(audioPath),
      metadataExists: existsSync(metadataPath),
      metadata,
      relativeFile: join(audioPlan.baseFilePath, asset.file),
      publicUrl: assetPublicUrl(asset),
    };
  });
}

export function RemotionAudioDashboard() {
  const assets = buildAssets();
  const generatedCount = assets.filter((item) => item.audioExists).length;
  const metadataCount = assets.filter((item) => item.metadataExists).length;
  const cueCount = audioPlan.cues.length;

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 px-4 py-5 md:px-6">
      <header className="rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4 shadow-[8px_8px_0_var(--pmb-ink)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-black tracking-[0.18em] uppercase">
              <Music2 className="h-4 w-4" />
              Remotion ElevenLabs Audio
            </p>
            <h1 className="mt-1 text-4xl leading-none md:text-5xl">
              PrompDojo Sound Board
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-white">v: {audioPlan.version}</Badge>
            <Badge className="bg-[var(--pmb-green)]">
              {generatedCount}/{assets.length} generated
            </Badge>
            <Badge className="bg-[var(--pmb-blue)]">
              {metadataCount}/{assets.length} metadata
            </Badge>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm font-bold md:grid-cols-3">
          <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-3">
            Duration: {audioPlan.durationSeconds}s
          </div>
          <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-3">
            Cues: {cueCount}
          </div>
          <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-white p-3 font-mono break-all">
            /{audioPlan.basePublicPath}
          </div>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <AssetCard item={assets[0]} featured />
        <Card className="bg-white">
          <div className="mb-3 flex items-center gap-2">
            <ListMusic className="h-5 w-5" />
            <h2 className="text-2xl">Cue Timeline</h2>
          </div>
          <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
            {audioPlan.cues.map((cue) => (
              <div
                key={cue.id}
                className="grid gap-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3 text-sm font-bold md:grid-cols-[88px_1fr_96px]"
              >
                <span className="font-mono">{formatTime(cue.at)}</span>
                <span>{cue.id}</span>
                <span className="font-mono">vol {cue.volume}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {assets.slice(1).map((item) => (
          <AssetCard key={item.asset.id} item={item} />
        ))}
      </section>
    </main>
  );
}

function AssetCard({
  item,
  featured = false,
}: {
  item: AssetViewModel;
  featured?: boolean;
}) {
  const { asset, cues, metadata } = item;
  const checksum = metadataChecksum(metadata);
  const isMusic = asset.kind === "music";

  return (
    <Card
      className={cn(
        "flex min-w-0 flex-col gap-3 bg-white",
        featured ? "min-h-[420px]" : "min-h-[360px]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-black tracking-[0.14em] uppercase">
            {isMusic ? (
              <Music2 className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {asset.kind}
          </p>
          <h2 className="mt-1 text-2xl leading-tight break-words">
            {asset.label}
          </h2>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <StatusBadge
            ok={item.audioExists}
            label={item.audioExists ? "generated" : "missing"}
          />
          <StatusBadge
            ok={item.metadataExists}
            label={item.metadataExists ? "metadata" : "no metadata"}
          />
          <Badge className="bg-[var(--pmb-yellow)]">{asset.outputFormat}</Badge>
        </div>
      </div>

      <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
        {item.audioExists ? (
          <audio
            className="w-full"
            controls
            preload="metadata"
            src={item.publicUrl}
          >
            <a href={item.publicUrl}>{asset.label}</a>
          </audio>
        ) : (
          <p className="flex items-center gap-2 text-sm font-black text-[var(--pmb-red)]">
            <AlertTriangle className="h-4 w-4" />
            Missing public audio file.
          </p>
        )}
      </div>

      <div className="grid gap-2 text-xs font-bold">
        <InfoRow
          icon={<FileAudio className="h-4 w-4" />}
          label="File"
          value={item.relativeFile}
        />
        <InfoRow
          icon={<Clock3 className="h-4 w-4" />}
          label="Duration"
          value={formatDuration(asset)}
        />
        <InfoRow label="Model" value={asset.modelId} />
        {asset.provider ? <InfoRow label="Provider" value={asset.provider} /> : null}
        {asset.sourceFile ? (
          <InfoRow label="Source" value={asset.sourceFile} />
        ) : null}
        <InfoRow label="Format" value={asset.outputFormat} />
        {checksum ? <InfoRow label="Checksum" value={checksum} /> : null}
        <InfoRow label="Bytes" value={formatBytes(metadata?.bytes)} />
        {metadata?.generatedAt ? (
          <InfoRow label="Generated" value={metadata.generatedAt} />
        ) : null}
      </div>

      <div className="rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
        <p className="text-xs font-black tracking-[0.14em] uppercase">Prompt</p>
        <p className="mt-2 text-xs leading-relaxed font-semibold break-words">
          {asset.prompt}
        </p>
      </div>

      <div className="mt-auto">
        <p className="mb-2 text-xs font-black tracking-[0.14em] uppercase">
          Used at {cues.length} cue{cues.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap gap-2">
          {cues.length > 0 ? (
            cues.map((cue) => (
              <Badge key={cue.id} className="bg-white font-mono">
                {formatTime(cue.at)}
                {cue.trimStartSeconds === undefined
                  ? ""
                  : ` / trim ${cue.trimStartSeconds}s`}
              </Badge>
            ))
          ) : (
            <Badge className="bg-white">music bed</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      className={
        ok ? "bg-[var(--pmb-green)]" : "bg-[var(--pmb-red)] text-white"
      }
    >
      {ok ? <BadgeCheck className="mr-1 h-3.5 w-3.5" /> : null}
      {label}
    </Badge>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 rounded-lg border-2 border-[var(--pmb-ink)] bg-white px-3 py-2">
      <span className="flex items-center gap-1 font-black uppercase">
        {icon}
        {label}
      </span>
      <span className="min-w-0 font-mono break-words">{value}</span>
    </div>
  );
}
