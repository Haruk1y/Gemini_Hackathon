import audioPlan from "./prompdojo-elevenlabs-audio-plan.json";

export interface PrompDojoAudioCue {
  id: string;
  at: number;
  src: string;
  volume: number;
  durationSeconds?: number;
  playbackRate?: number;
  trimStartSeconds?: number;
}

interface PrompDojoAudioPlanAsset {
  id: string;
  src: string;
}

interface PrompDojoAudioPlanCue {
  id: string;
  assetId: string;
  at: number;
  volume: number;
  durationSeconds?: number;
  playbackRate?: number;
  trimStartSeconds?: number;
}

const audioAssets = audioPlan.assets as PrompDojoAudioPlanAsset[];
const audioCues = audioPlan.cues as PrompDojoAudioPlanCue[];
const audioAssetById = new Map(
  audioAssets.map((asset) => [asset.id, asset] as const),
);

export const prompDojoMusicSource = audioPlan.music.src;

export const prompDojoAudioCues: PrompDojoAudioCue[] = audioCues.map((cue) => {
  const asset = audioAssetById.get(cue.assetId);

  if (!asset) {
    throw new Error(`Unknown PrompDojo audio asset: ${cue.assetId}`);
  }

  return {
    id: cue.id,
    at: cue.at,
    src: asset.src,
    volume: cue.volume,
    durationSeconds: cue.durationSeconds,
    playbackRate: cue.playbackRate,
    trimStartSeconds: cue.trimStartSeconds,
  };
});
