import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sampleRate = 44100;
const musicDurationSeconds = 93.8;
const bpm = 136;
const beatSeconds = 60 / bpm;

let noiseSeed = 123456789;

function randomSigned() {
  noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
  return (noiseSeed / 0xffffffff) * 2 - 1;
}

function createTrack(durationSeconds) {
  const totalSamples = Math.ceil(sampleRate * durationSeconds);

  return {
    durationSeconds,
    totalSamples,
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
  };
}

function addSample(track, index, left, right = left) {
  if (index < 0 || index >= track.totalSamples) return;
  track.left[index] += left;
  track.right[index] += right;
}

function stereoGain(pan) {
  const normalized = Math.max(-1, Math.min(1, pan));
  const angle = ((normalized + 1) * Math.PI) / 4;

  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  };
}

function envelope(t, duration, attack = 0.012, releaseStartRatio = 0.66) {
  if (t < 0 || t > duration) return 0;

  const attackSeconds = Math.min(attack, duration * 0.3);
  const releaseStart = duration * releaseStartRatio;

  if (t < attackSeconds) {
    return attackSeconds <= 0 ? 1 : t / attackSeconds;
  }

  if (t > releaseStart) {
    return Math.max(0, 1 - (t - releaseStart) / (duration - releaseStart));
  }

  return 1;
}

function waveValue(phase, waveform) {
  if (waveform === "square") return Math.sign(Math.sin(phase));
  if (waveform === "saw") return 2 * ((phase / (Math.PI * 2)) % 1) - 1;
  if (waveform === "triangle") {
    return (2 / Math.PI) * Math.asin(Math.sin(phase));
  }

  return Math.sin(phase);
}

function addTone(
  track,
  start,
  duration,
  frequencyStart,
  frequencyEnd,
  gain,
  waveform = "sine",
  pan = 0,
) {
  const startIndex = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  const stereo = stereoGain(pan);
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const progress = duration <= 0 ? 0 : t / duration;
    const frequency =
      frequencyStart + (frequencyEnd - frequencyStart) * progress;
    phase += (Math.PI * 2 * frequency) / sampleRate;
    const value = waveValue(phase, waveform) * gain * envelope(t, duration);

    addSample(track, startIndex + i, value * stereo.left, value * stereo.right);
  }
}

function addNoiseBurst(track, start, duration, gain, pan = 0) {
  const startIndex = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  const stereo = stereoGain(pan);
  let previous = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const raw = randomSigned();
    const shaped = raw - previous * 0.55;
    previous = raw;
    const value = shaped * gain * envelope(t, duration, 0.004, 0.35);

    addSample(track, startIndex + i, value * stereo.left, value * stereo.right);
  }
}

function addKick(track, start, gain = 0.26) {
  const duration = 0.24;
  const startIndex = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const frequency = 142 - 94 * (t / duration);
    phase += (Math.PI * 2 * frequency) / sampleRate;
    const value = Math.sin(phase) * gain * Math.exp(-t * 17);

    addSample(track, startIndex + i, value);
  }
}

function addSnare(track, start, gain = 0.13) {
  addNoiseBurst(track, start, 0.13, gain * 0.72, 0.08);
  addTone(track, start, 0.13, 210, 150, gain * 0.58, "triangle", -0.06);
}

function addHat(track, start, gain = 0.05) {
  addNoiseBurst(track, start, 0.045, gain, 0.28);
}

function addPop(track, start, gain = 0.16) {
  addTone(track, start, 0.1, 740, 1220, gain, "sine", -0.16);
  addTone(track, start + 0.035, 0.12, 1200, 620, gain * 0.58, "square", 0.18);
}

function addScoreHit(track, start, gain = 0.28) {
  addTone(track, start, 0.18, 190, 78, gain, "sine", 0);
  addNoiseBurst(track, start + 0.015, 0.18, gain * 0.45, 0.12);
  addTone(track, start + 0.08, 0.28, 560, 760, gain * 0.42, "square", -0.14);
  addTone(track, start + 0.18, 0.36, 980, 1320, gain * 0.18, "triangle", 0.22);
}

function addWhoosh(track, start, duration, gain = 0.12) {
  addNoiseBurst(track, start, duration, gain, -0.28);
  addTone(track, start, duration, 220, 1420, gain * 0.72, "saw", 0.24);
}

function addRiser(track, start, duration, gain = 0.08) {
  addTone(track, start, duration, 180, 980, gain, "saw", -0.12);
  addTone(
    track,
    start + duration * 0.24,
    duration * 0.76,
    360,
    1640,
    gain * 0.45,
    "triangle",
    0.24,
  );
  addNoiseBurst(
    track,
    start + duration * 0.58,
    duration * 0.35,
    gain * 0.28,
    0,
  );
}

function addMusicBed(track) {
  const chordRoots = [261.63, 329.63, 392.0, 293.66];

  for (let i = 0; i < track.totalSamples; i += 1) {
    const t = i / sampleRate;
    const beat = t / beatSeconds;
    const chord = chordRoots[Math.floor(beat / 4) % chordRoots.length];
    const phaseBeat = beat % 1;
    const barProgress = (beat % 4) / 4;
    const sectionEnergy =
      t < 10.5
        ? 0.76
        : t < 28.8
          ? 0.96
          : t < 36.5
            ? 1.08
            : t < 86.0
              ? 1.18
              : 0.92;
    const fadeOut =
      t > musicDurationSeconds - 2
        ? Math.max(0, (musicDurationSeconds - t) / 2)
        : 1;
    const sidechain = 0.68 + 0.32 * Math.min(1, phaseBeat * 3.4);
    const arpNote = chord * [1, 1.25, 1.5, 2][Math.floor(beat * 2) % 4];
    const bass = Math.sin(Math.PI * 2 * (chord / 2) * t) * 0.058;
    const arp =
      Math.sign(Math.sin(Math.PI * 2 * arpNote * t)) *
      (0.018 + barProgress * 0.012);
    const pad =
      Math.sin(Math.PI * 2 * chord * t) * 0.018 +
      Math.sin(Math.PI * 2 * chord * 1.5 * t + 0.4) * 0.014;
    const shimmer =
      Math.sin(Math.PI * 2 * (arpNote * 2 + 5 * Math.sin(t)) * t) * 0.008;
    const value =
      (bass + arp + pad + shimmer) * sidechain * sectionEnergy * fadeOut;

    addSample(track, i, value * 0.93, value * 1.04);
  }

  for (let t = 0; t < musicDurationSeconds; t += beatSeconds) {
    const beatIndex = Math.round(t / beatSeconds);
    const isModeShowcase = t >= 36.5 && t < 86.0;

    addKick(track, t, isModeShowcase ? 0.3 : 0.24);
    addHat(track, t + beatSeconds * 0.5, isModeShowcase ? 0.064 : 0.048);

    if (beatIndex % 2 === 1) {
      addSnare(track, t, isModeShowcase ? 0.15 : 0.11);
    }
  }

  [0.25, 10.5, 16.5, 28.8, 35.0, 36.5, 86.0].forEach((time) => {
    addRiser(track, Math.max(0, time - 0.7), 0.78, 0.07);
  });

  [5.65, 6.7, 26.55, 30.45, 65.0, 79.2, 86.3].forEach((time) => {
    addScoreHit(track, time, 0.1);
  });
}

function writeWav(outputPath, track) {
  mkdirSync(dirname(outputPath), { recursive: true });

  let max = 0;
  for (let i = 0; i < track.totalSamples; i += 1) {
    max = Math.max(max, Math.abs(track.left[i]), Math.abs(track.right[i]));
  }

  const normalization = max > 0 ? 0.92 / max : 1;
  const channels = 2;
  const bytesPerSample = 2;
  const dataSize = track.totalSamples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < track.totalSamples; i += 1) {
    const left = Math.max(-1, Math.min(1, track.left[i] * normalization));
    const right = Math.max(-1, Math.min(1, track.right[i] * normalization));
    const offset = 44 + i * channels * bytesPerSample;

    buffer.writeInt16LE(Math.round(left * 32767), offset);
    buffer.writeInt16LE(Math.round(right * 32767), offset + 2);
  }

  writeFileSync(outputPath, buffer);
  console.log(`Wrote ${outputPath}`);
}

function makeSfx(durationSeconds, build) {
  const track = createTrack(durationSeconds);
  build(track);
  return track;
}

const music = createTrack(musicDurationSeconds);
addMusicBed(music);
writeWav(resolve("public/remotion/audio/music/promptdojo-main.wav"), music);

const sfx = [
  [
    "title-slam.wav",
    makeSfx(0.9, (track) => {
      addWhoosh(track, 0, 0.35, 0.12);
      addScoreHit(track, 0.18, 0.34);
      addTone(track, 0.18, 0.52, 120, 54, 0.3, "sine");
    }),
  ],
  [
    "ui-click.wav",
    makeSfx(0.16, (track) => {
      addTone(track, 0, 0.06, 1160, 720, 0.22, "square", -0.1);
      addNoiseBurst(track, 0.01, 0.05, 0.07, 0.16);
    }),
  ],
  [
    "typing-tick.wav",
    makeSfx(0.08, (track) => {
      addTone(track, 0, 0.045, 980, 1280, 0.16, "triangle", -0.12);
      addNoiseBurst(track, 0.006, 0.035, 0.035, 0.18);
    }),
  ],
  [
    "generate-whoosh.wav",
    makeSfx(1.05, (track) => {
      addWhoosh(track, 0, 0.92, 0.16);
      addTone(track, 0.42, 0.46, 740, 1620, 0.09, "triangle", 0.22);
    }),
  ],
  [
    "score-hit.wav",
    makeSfx(0.76, (track) => {
      addScoreHit(track, 0, 0.36);
      addPop(track, 0.22, 0.14);
    }),
  ],
  [
    "mode-card-pop.wav",
    makeSfx(0.48, (track) => {
      addPop(track, 0, 0.22);
      addTone(track, 0.1, 0.28, 420, 980, 0.1, "triangle", 0.16);
    }),
  ],
  [
    "vote-reveal.wav",
    makeSfx(0.96, (track) => {
      addTone(track, 0, 0.32, 320, 120, 0.22, "saw", -0.12);
      addNoiseBurst(track, 0.08, 0.28, 0.11, 0.22);
      addScoreHit(track, 0.44, 0.24);
    }),
  ],
  [
    "final-sting.wav",
    makeSfx(1.7, (track) => {
      [0, 0.12, 0.24, 0.36].forEach((offset, index) => {
        addTone(
          track,
          offset,
          0.5,
          [392, 523.25, 659.25, 784][index],
          [392, 523.25, 659.25, 784][index],
          0.14,
          "triangle",
          index % 2 === 0 ? -0.2 : 0.2,
        );
      });
      addScoreHit(track, 0.55, 0.28);
      addTone(track, 0.7, 0.8, 196, 98, 0.2, "sine", 0);
    }),
  ],
];

for (const [filename, track] of sfx) {
  writeWav(resolve(`public/remotion/audio/sfx/${filename}`), track);
}
