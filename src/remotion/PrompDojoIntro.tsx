import type { CSSProperties, ReactNode } from "react";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { prompDojoAudioCues, prompDojoMusicSource } from "./prompdojo-audio";

export const FPS = 30;
export const PROMPDOJO_DURATION_SECONDS = 89.7;
export const PROMPDOJO_DURATION_FRAMES = Math.round(
  FPS * PROMPDOJO_DURATION_SECONDS,
);

const theme = {
  ink: "#101010",
  base: "#fff7e6",
  red: "#ff3b30",
  blue: "#00a8ff",
  yellow: "#ffd60a",
  green: "#2ecc71",
  white: "#ffffff",
  purpleDeep: "#2c0f7f",
  purple: "#5318ca",
  purpleLift: "#7039e9",
  pink: "#fa2599",
} as const;

const fontStack =
  '"Arial Black", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const bodyFont =
  '"Inter", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const monoFont = '"SFMono-Regular", "Menlo", "Consolas", monospace';
const partyHeroSource =
  "remotion/prompdojo-intro/generated/distinct/party-hero-distinct.png";
const gameplayQrSource = "remotion/qr/gameplay-qr.png";
const projectPageQrSource = "remotion/qr/project-page-qr.png";
const ahaBeforeSource = "remotion/prompdojo-intro/modes/aha-before.png";
const ahaAfterSource = "remotion/prompdojo-intro/modes/aha-after.png";

type ModeArtKey = "classic" | "memory" | "artImposter" | "aha";

const modeArtSources: Record<ModeArtKey, string> = {
  classic: "remotion/prompdojo-intro/modes/classic-wide.png",
  memory: "remotion/prompdojo-intro/modes/memory-wide.png",
  artImposter: "remotion/prompdojo-intro/modes/art-imposter-wide.png",
  aha: "remotion/prompdojo-intro/modes/aha-moment-wide.png",
};

const f = (seconds: number) => Math.round(seconds * FPS);

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const localProgress = (
  frame: number,
  fps: number,
  startSeconds: number,
  endSeconds: number,
) =>
  clamp(
    interpolate(frame, [startSeconds * fps, endSeconds * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  );

const popScale = (frame: number, fps: number, startSeconds: number) =>
  spring({
    frame: Math.max(0, frame - startSeconds * fps),
    fps,
    config: {
      damping: 12,
      mass: 0.85,
      stiffness: 180,
    },
  });

const card: CSSProperties = {
  border: `6px solid ${theme.ink}`,
  borderRadius: 18,
  boxShadow: `12px 12px 0 ${theme.ink}`,
};

const fill: CSSProperties = {
  position: "absolute",
  inset: 0,
};

function SceneBackground({
  energy = 1,
  frameOffset = 0,
}: {
  energy?: number;
  frameOffset?: number;
}) {
  const localFrame = useCurrentFrame();
  const frame = localFrame + frameOffset;
  const drift = frame * energy * 0.8;
  const pattern = `url("data:image/svg+xml,%3Csvg width='360' height='280' viewBox='0 0 360 280' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='12' stroke-linecap='round' stroke-linejoin='round' opacity='.34'%3E%3Cpath d='M36 66l34 35 45-55 32 66'/%3E%3Cpath d='M190 25l42 18-18 42 48 12'/%3E%3Cpath d='M24 218h76M62 180v78'/%3E%3Cpath d='M230 208c26-34 54-34 82 0'/%3E%3Cpath d='M292 48l28 28-28 28-28-28z'/%3E%3Cpath d='M126 202l32-36 33 36'/%3E%3Cpath d='M74 18c34 10 54 10 88 0'/%3E%3Cpath d='M303 140h44M325 118v44'/%3E%3C/g%3E%3Cg fill='%23ffffff' opacity='.28'%3E%3Ccircle cx='322' cy='232' r='10'/%3E%3Ccircle cx='147' cy='124' r='8'/%3E%3Ccircle cx='37' cy='24' r='7'/%3E%3C/g%3E%3C/svg%3E")`;

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background:
          `radial-gradient(circle at 70% 16%, rgba(112,57,233,0.74), transparent 28%), ` +
          `radial-gradient(circle at 16% 86%, rgba(250,37,153,0.42), transparent 33%), ` +
          `linear-gradient(135deg, ${theme.purpleLift} 0%, ${theme.purple} 43%, ${theme.purpleDeep} 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -220,
          opacity: 0.28,
          backgroundImage: pattern,
          backgroundSize: "360px 280px",
          backgroundPosition: `${drift}px ${drift * 0.7}px`,
          transform: "rotate(-10deg)",
        }}
      />
    </AbsoluteFill>
  );
}

function Stamp({
  children,
  color = theme.yellow,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        border: `5px solid ${theme.ink}`,
        borderRadius: 14,
        background: color,
        boxShadow: `7px 7px 0 ${theme.ink}`,
        color: theme.ink,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fontStack,
        letterSpacing: 0,
        padding: "10px 18px",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Spinner({
  size = 70,
  color = theme.blue,
}: {
  size?: number;
  color?: string;
}) {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `8px solid ${theme.ink}`,
        borderTopColor: color,
        borderRightColor: color,
        transform: `rotate(${frame * 18}deg)`,
      }}
    />
  );
}

type ArtVariant = "target" | "winner" | "near" | "chaos" | "miss";

const artSources: Record<ArtVariant, string> = {
  target: "remotion/prompdojo-intro/generated/target.png",
  winner: "remotion/prompdojo-intro/generated/winner.png",
  near: "remotion/prompdojo-intro/generated/near.png",
  chaos: "remotion/prompdojo-intro/generated/chaos.png",
  miss: "remotion/prompdojo-intro/generated/miss.png",
};

function Artwork({
  variant,
  objectPosition = "50% 50%",
}: {
  variant: ArtVariant;
  objectPosition?: string;
}) {
  return (
    <Img
      src={staticFile(artSources[variant])}
      aria-label={`${variant} generated artwork`}
      style={{
        display: "block",
        height: "100%",
        width: "100%",
        objectFit: "cover",
        objectPosition,
      }}
    />
  );
}

function ModeArtwork({
  artKey,
  fit = "contain",
  objectPosition = "50% 50%",
}: {
  artKey: ModeArtKey;
  fit?: "contain" | "cover";
  objectPosition?: string;
}) {
  return (
    <Img
      src={staticFile(modeArtSources[artKey])}
      aria-label={`${artKey} mode artwork`}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: fit,
        objectPosition,
      }}
    />
  );
}

function ArtCard({
  variant,
  label,
  score,
  highlight = false,
}: {
  variant: ArtVariant;
  label: string;
  score?: number;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        ...card,
        background: theme.white,
        overflow: "hidden",
        boxShadow: highlight
          ? `14px 14px 0 ${theme.ink}`
          : `9px 9px 0 ${theme.ink}`,
      }}
    >
      <div
        style={{
          height: 48,
          background: highlight ? theme.yellow : theme.base,
          borderBottom: `5px solid ${theme.ink}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          fontFamily: fontStack,
          fontSize: 21,
        }}
      >
        <span>{label}</span>
        {typeof score === "number" ? (
          <span style={{ fontFamily: monoFont }}>{score} pts</span>
        ) : null}
      </div>
      <div style={{ height: 250 }}>
        <Artwork variant={variant} />
      </div>
    </div>
  );
}

function PromptEditor({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        border: `4px solid ${theme.ink}`,
        borderRadius: 14,
        background: theme.white,
        padding: compact ? "12px 14px" : "18px 20px",
        minHeight: compact ? 90 : 138,
        fontFamily: monoFont,
        fontSize: compact ? 19 : 25,
        fontWeight: 800,
        lineHeight: 1.35,
        color: theme.ink,
        whiteSpace: "pre-wrap",
        overflowWrap: "normal",
      }}
    >
      <span style={{ color: theme.blue }}>Write:</span> {text}
      <span style={{ color: theme.red }}>|</span>
    </div>
  );
}

function ChapterTitle({
  title,
  backgroundFrameOffset = 0,
  backgroundEnergy = 1.35,
}: {
  title: string;
  backgroundFrameOffset?: number;
  backgroundEnergy?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = popScale(frame, fps, 0.16);
  const titleSize = title.length > 13 ? 118 : title.length > 11 ? 142 : 160;

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground
        energy={backgroundEnergy}
        frameOffset={backgroundFrameOffset}
      />
      <div
        style={{
          ...fill,
          background:
            "linear-gradient(180deg, rgba(16,16,16,0.08), rgba(16,16,16,0.18))",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          padding: "0 90px",
        }}
      >
        <div
          style={{
            transform: `scale(${0.86 + enter * 0.14})`,
            transformOrigin: "center",
          }}
        >
          <div
            style={{
              color: theme.white,
              fontFamily: fontStack,
              fontSize: titleSize,
              lineHeight: 0.86,
              letterSpacing: 0,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              WebkitTextStroke: `8px ${theme.ink}`,
              paintOrder: "stroke fill",
              textShadow: `0 16px 0 ${theme.ink}`,
            }}
          >
            {title}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

type AvatarMood = "happy" | "focused" | "sad" | "shocked";

type Player = {
  name: string;
  color: string;
  prompt: string;
  score: number;
  variant: ArtVariant;
  avatar: string;
  avatars: Record<AvatarMood, string>;
  mood: AvatarMood;
};

const avatarSet = (name: string): Record<AvatarMood, string> => ({
  happy: `remotion/prompdojo-intro/avatars/generated-distinct/${name}-happy.png`,
  focused: `remotion/prompdojo-intro/avatars/generated-distinct/${name}-focused.png`,
  sad: `remotion/prompdojo-intro/avatars/generated-distinct/${name}-sad.png`,
  shocked: `remotion/prompdojo-intro/avatars/generated-distinct/${name}-shocked.png`,
});

const players: Player[] = [
  {
    name: "Aoi",
    color: theme.red,
    prompt: "orange rocket above a tropical island",
    score: 92,
    variant: "winner",
    avatar: "remotion/prompdojo-intro/avatars/generated-distinct/aoi-happy.png",
    avatars: avatarSet("aoi"),
    mood: "happy",
  },
  {
    name: "Ren",
    color: theme.blue,
    prompt: "toy rocket over bright blue water",
    score: 78,
    variant: "near",
    avatar: "remotion/prompdojo-intro/avatars/generated-distinct/ren-happy.png",
    avatars: avatarSet("ren"),
    mood: "sad",
  },
  {
    name: "Mika",
    color: theme.green,
    prompt: "sushi-roll rocket over tropical islands",
    score: 41,
    variant: "chaos",
    avatar:
      "remotion/prompdojo-intro/avatars/generated-distinct/mika-happy.png",
    avatars: avatarSet("mika"),
    mood: "shocked",
  },
  {
    name: "Jun",
    color: theme.yellow,
    prompt: "tiny plane near a castle island",
    score: 65,
    variant: "miss",
    avatar: "remotion/prompdojo-intro/avatars/generated-distinct/jun-happy.png",
    avatars: avatarSet("jun"),
    mood: "sad",
  },
];

function PlayerAvatar({
  player,
  size = 64,
  mood = player.mood,
  label = false,
}: {
  player: Player;
  size?: number;
  mood?: AvatarMood;
  label?: boolean;
}) {
  const avatar = player.avatars[mood] ?? player.avatar;

  return (
    <div
      style={{
        display: "inline-grid",
        justifyItems: "center",
        gap: label ? 8 : 0,
      }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          boxShadow: `${Math.max(5, size * 0.09)}px ${Math.max(5, size * 0.09)}px 0 ${theme.ink}`,
        }}
      >
        <Img
          src={staticFile(avatar)}
          aria-label={`${player.name} avatar`}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            display: "block",
          }}
        />
      </div>
      {label ? (
        <div
          style={{ fontFamily: fontStack, fontSize: Math.round(size * 0.24) }}
        >
          {player.name}
        </div>
      ) : null}
    </div>
  );
}

function ColdOpen() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleLines = [
    ["WHO", "CAN", "GENERATE"],
    ["THE", "CLOSEST", "IMAGE?"],
  ];
  const titleWords = titleLines.flat();
  const bigTitleExit = localProgress(frame, fps, 1.52, 1.92);
  const topTitleEnter = localProgress(frame, fps, 1.66, 1.98);
  const titleOpacity = localProgress(frame, fps, 0.08, 0.28);
  const titlePop = popScale(frame, fps, 0.14);
  const targetReveal = localProgress(frame, fps, 2.08, 2.55);
  const resultReveal = localProgress(frame, fps, 5.65, 6.05);
  const winnerReveal = localProgress(frame, fps, 7.4, 8.15);
  const winnerConfetti = localProgress(frame, fps, 7.35, 7.7);

  return (
    <AbsoluteFill
      style={{
        fontFamily: bodyFont,
      }}
    >
      <SceneBackground energy={2} />
      <div style={{ ...fill, opacity: winnerConfetti, pointerEvents: "none" }}>
        <Confetti />
      </div>
      <div
        style={{
          position: "absolute",
          left: 68,
          top: 178,
          width: 630,
          bottom: 82,
          ...card,
          background: theme.white,
          padding: 20,
          opacity: targetReveal,
          transform: `translateX(${(1 - targetReveal) * -64}px) rotate(-2deg) scale(${0.92 + targetReveal * 0.08})`,
          transformOrigin: "center",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontStack,
            fontSize: 34,
            marginBottom: 16,
          }}
        >
          <span>TARGET IMAGE</span>
        </div>
        <div
          style={{
            border: `6px solid ${theme.ink}`,
            borderRadius: 16,
            background: theme.white,
            height: 620,
            overflow: "hidden",
            boxShadow: `9px 9px 0 ${theme.ink}`,
          }}
        >
          <Artwork variant="target" />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 748,
          right: 52,
          top: 176,
          bottom: 74,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
        }}
      >
        {players.map((player, index) => {
          const appear = 2.6 + 0.12 * index;
          const typingStart = 3.28 + index * 0.09;
          const typingEnd = 4.65 + index * 0.09;
          const generatingStart = 5.05;
          const scorePop = 6.7 + index * 0.14;
          const enter = localProgress(frame, fps, appear, appear + 0.32);
          const cardLift = index === 0 ? winnerReveal * -18 : 0;
          const typed = Math.floor(
            interpolate(
              frame,
              [typingStart * fps, typingEnd * fps],
              [0, player.prompt.length],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          );
          const generatingOpacity = localProgress(
            frame,
            fps,
            generatingStart,
            generatingStart + 0.14,
          );
          const resultPop = popScale(frame, fps, 5.65);
          const scoreScale = popScale(frame, fps, scorePop);
          const scoreOpacity = localProgress(
            frame,
            fps,
            scorePop,
            scorePop + 0.18,
          );
          const isWinner = index === 0;
          const winnerAvatarCheer = isWinner
            ? Math.sin(localProgress(frame, fps, 7.72, 8.35) * Math.PI)
            : 0;

          return (
            <div
              key={player.name}
              style={{
                position: "relative",
                ...card,
                background: player.color,
                padding: 14,
                overflow: "hidden",
                opacity: enter,
                transform: `translateY(${(1 - enter) * 42 + cardLift}px) rotate(${index % 2 === 0 ? -1.5 : 1.5}deg) scale(${isWinner ? 1 + winnerReveal * 0.035 : 1})`,
              }}
            >
              {isWinner ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    opacity: winnerReveal * 0.45,
                    background:
                      "repeating-linear-gradient(-10deg, transparent 0 18px, rgba(255,255,255,0.9) 18px 30px)",
                  }}
                />
              ) : null}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                  fontFamily: fontStack,
                  fontSize: 25,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      transform: `translateY(${-18 * winnerAvatarCheer}px) scale(${1 + winnerAvatarCheer * 0.18})`,
                    }}
                  >
                    <PlayerAvatar
                      player={player}
                      size={46}
                      mood={
                        isWinner && winnerReveal > 0.2 ? "happy" : "focused"
                      }
                    />
                  </div>
                  <span>{player.name}</span>
                </div>
              </div>
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    border: `4px solid ${theme.ink}`,
                    borderRadius: 14,
                    background: theme.white,
                    padding: "14px 16px",
                    height: 82,
                    fontFamily: monoFont,
                    fontSize: 17,
                    fontWeight: 900,
                    lineHeight: 1.2,
                    overflow: "hidden",
                  }}
                >
                  <span style={{ color: theme.blue }}>Prompt:</span>{" "}
                  {player.prompt.slice(0, typed)}
                  <span style={{ color: theme.red }}>|</span>
                </div>
                <div
                  style={{
                    border: `4px solid ${theme.ink}`,
                    borderRadius: 14,
                    background: theme.white,
                    height: 210,
                    marginTop: 12,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {resultReveal > 0 ? (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        opacity: resultReveal,
                        transform: `scale(${resultPop})`,
                      }}
                    >
                      <Artwork
                        variant={player.variant}
                        objectPosition="50% 32%"
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        placeItems: "center",
                        gap: 8,
                        opacity: generatingOpacity,
                      }}
                    >
                      <Spinner size={54} color={player.color} />
                      <div style={{ fontFamily: fontStack, fontSize: 18 }}>
                        Generating...
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  right: 16,
                  top: 156,
                  opacity: scoreOpacity,
                  transform: `rotate(8deg) scale(${scoreScale})`,
                  zIndex: 3,
                }}
              >
                <Stamp
                  color={isWinner ? theme.yellow : theme.white}
                  style={{
                    fontSize: 30,
                    minWidth: 148,
                    padding: "12px 16px",
                  }}
                >
                  {player.score} pts
                </Stamp>
              </div>
              {isWinner ? (
                <Stamp
                  color={theme.red}
                  style={{
                    position: "absolute",
                    left: 18,
                    bottom: 20,
                    color: theme.white,
                    fontSize: 24,
                    opacity: winnerReveal,
                    transform: `rotate(-6deg) scale(${0.8 + winnerReveal * 0.2})`,
                    zIndex: 4,
                  }}
                >
                  WINNER
                </Stamp>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1800,
          transform: `translate(-50%, -50%) translateY(${-290 * bigTitleExit}px) scale(${(0.92 + titlePop * 0.08) * (1 - bigTitleExit * 0.28)})`,
          transformOrigin: "center center",
          zIndex: 7,
          opacity: titleOpacity * (1 - bigTitleExit),
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 18,
            fontFamily: fontStack,
            fontSize: 124,
            lineHeight: 0.86,
            textAlign: "center",
            letterSpacing: 0,
            textTransform: "uppercase",
          }}
        >
          {titleLines.map((line, lineIndex) => (
            <div
              key={line.join(" ")}
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "baseline",
                gap: 24,
                whiteSpace: "nowrap",
              }}
            >
              {line.map((word) => {
                const index = titleWords.indexOf(word);
                const start = 0.14 + index * 0.19;
                const wordIn = localProgress(frame, fps, start, start + 0.38);
                const wordPop = popScale(frame, fps, start + 0.04);
                const slideX = interpolate(wordIn, [0, 1], [-96, 0]);
                const slideY = interpolate(
                  wordIn,
                  [0, 1],
                  [lineIndex === 0 ? -18 : 18, 0],
                );
                const skew = interpolate(wordIn, [0, 1], [-10, 0]);
                const blur = interpolate(wordIn, [0, 1], [6, 0]);

                return (
                  <span
                    key={word}
                    style={{
                      display: "inline-block",
                      color: theme.white,
                      WebkitTextStroke: `8px ${theme.ink}`,
                      paintOrder: "stroke fill",
                      textShadow: `0 13px 0 ${theme.ink}`,
                      opacity: wordIn,
                      filter: `blur(${blur}px)`,
                      transform: `translate(${slideX}px, ${slideY}px) skewX(${skew}deg) scale(${0.95 + wordPop * 0.05})`,
                    }}
                  >
                    {word}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 42,
          left: "50%",
          width: 1600,
          transform: `translateX(-50%) translateY(${(1 - topTitleEnter) * 44}px) scale(${0.96 + topTitleEnter * 0.04})`,
          transformOrigin: "top center",
          zIndex: 7,
          opacity: topTitleEnter,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: theme.white,
            fontFamily: fontStack,
            fontSize: 62,
            lineHeight: 0.9,
            letterSpacing: 0,
            textAlign: "center",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            WebkitTextStroke: `5px ${theme.ink}`,
            paintOrder: "stroke fill",
            textShadow: `0 9px 0 ${theme.ink}`,
          }}
        >
          WHO CAN GENERATE THE CLOSEST IMAGE?
        </div>
      </div>
    </AbsoluteFill>
  );
}

function TitleHit() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = popScale(frame, fps, 0.28);
  const subtitle = localProgress(frame, fps, 1.2, 1.8);

  return (
    <AbsoluteFill
      style={{ background: theme.ink, color: theme.white, overflow: "hidden" }}
    >
      <Img
        src={staticFile(partyHeroSource)}
        style={{
          ...fill,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.88,
          transform: `scale(${1.06 - localProgress(frame, fps, 0, 7) * 0.04})`,
        }}
      />
      <div
        style={{
          ...fill,
          background:
            "linear-gradient(90deg, rgba(16,16,16,0.9) 0%, rgba(16,16,16,0.58) 42%, rgba(16,16,16,0.08) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 145,
          width: 850,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: fontStack,
            fontSize: 154,
            lineHeight: 0.9,
            letterSpacing: 0,
            textShadow: `10px 10px 0 ${theme.ink}`,
            transform: `scale(${logo})`,
            transformOrigin: "left center",
          }}
        >
          Promp
          <span style={{ color: theme.yellow }}>Dojo</span>
        </h1>
        <p
          style={{
            margin: "30px 0 0",
            fontFamily: fontStack,
            fontSize: 49,
            lineHeight: 1.18,
            opacity: subtitle,
            transform: `translateX(${(1 - subtitle) * -36}px)`,
            color: theme.white,
          }}
        >
          See the AI image. Guess the prompt. Battle your friends.
        </p>
      </div>
    </AbsoluteFill>
  );
}

function RoomSetup() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const readyCount = players.filter(
    (_, index) => frame > (5 + index * 1.35) * fps,
  ).length;

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={0.7} />
      <div
        style={{
          position: "absolute",
          left: 95,
          top: 120,
          width: 780,
          ...card,
          background: theme.white,
          padding: 34,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontFamily: fontStack, fontSize: 54 }}>
              Create a room
            </div>
            <div
              style={{
                marginTop: 12,
                fontFamily: monoFont,
                fontSize: 34,
                fontWeight: 900,
              }}
            >
              Room Code: PMD7X2
            </div>
          </div>
          <Stamp color={theme.yellow} style={{ fontSize: 33 }}>
            {readyCount}/4 READY
          </Stamp>
        </div>

        <div style={{ marginTop: 32, display: "grid", gap: 16 }}>
          {players.map((player, index) => {
            const join = localProgress(
              frame,
              fps,
              1.4 + index * 0.75,
              1.8 + index * 0.75,
            );
            const isReady = frame > (5 + index * 1.35) * fps;

            return (
              <div
                key={player.name}
                style={{
                  border: `4px solid ${theme.ink}`,
                  borderRadius: 16,
                  background: index === 0 ? theme.yellow : theme.base,
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  opacity: join,
                  transform: `translateX(${(1 - join) * -42}px)`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <PlayerAvatar player={player} size={54} />
                  <div style={{ fontFamily: fontStack, fontSize: 30 }}>
                    {player.name}
                    {index === 0 ? "  HOST" : ""}
                  </div>
                </div>
                <Stamp
                  color={isReady ? theme.green : theme.white}
                  style={{ fontSize: 23, boxShadow: `5px 5px 0 ${theme.ink}` }}
                >
                  {isReady ? "READY" : "WAIT"}
                </Stamp>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 118,
          top: 138,
          width: 720,
          height: 620,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 30,
            top: 0,
            width: 560,
            ...card,
            background: theme.ink,
            padding: 20,
            transform: "rotate(2deg)",
          }}
        >
          <div
            style={{
              height: 315,
              border: `5px solid ${theme.ink}`,
              background: theme.white,
              overflow: "hidden",
            }}
          >
            <Img
              src={staticFile(partyHeroSource)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <div
            style={{
              marginTop: 18,
              color: theme.white,
              fontFamily: fontStack,
              fontSize: 38,
              paddingRight: 10,
              textAlign: "right",
            }}
          >
            Start Round
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: 280,
            height: 500,
            border: `8px solid ${theme.ink}`,
            borderRadius: 34,
            boxShadow: `12px 12px 0 ${theme.ink}`,
            background: theme.white,
            padding: 20,
            transform: "rotate(-7deg)",
          }}
        >
          <div
            style={{
              height: "100%",
              border: `4px solid ${theme.ink}`,
              borderRadius: 22,
              background: theme.base,
              padding: 18,
              display: "grid",
              gap: 12,
              alignContent: "start",
            }}
          >
            <div style={{ fontFamily: fontStack, fontSize: 28 }}>Join</div>
            <div style={{ fontFamily: monoFont, fontSize: 25 }}>PMD7X2</div>
            {players.slice(1).map((player) => (
              <div
                key={player.name}
                style={{
                  border: `3px solid ${theme.ink}`,
                  borderRadius: 12,
                  background: player.color,
                  padding: "9px 12px",
                  fontFamily: fontStack,
                  fontSize: 18,
                }}
              >
                {player.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

const coreLoopPhases = [
  { label: "Observe", start: 0, end: 3.25, color: theme.blue },
  { label: "Write", start: 3.25, end: 6.25, color: theme.yellow },
  { label: "Generate", start: 6.25, end: 7.55, color: theme.red },
  { label: "Score", start: 7.55, end: 10.8, color: theme.green },
];

function GameLoopProgress() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const activeIndex = coreLoopPhases.findIndex(
    (phase) => seconds >= phase.start && seconds < phase.end,
  );
  const safeActiveIndex =
    activeIndex === -1 ? coreLoopPhases.length - 1 : activeIndex;

  return (
    <div
      style={{
        position: "absolute",
        left: 150,
        right: 150,
        top: 42,
        ...card,
        background: theme.white,
        padding: "22px 26px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 64px 1fr 64px 1fr 64px 1fr",
          alignItems: "center",
          gap: 8,
        }}
      >
        {coreLoopPhases.flatMap((phase, index) => {
          const isActive = index === safeActiveIndex;
          const isPast = index < safeActiveIndex;
          const phaseNode = (
            <div
              key={phase.label}
              style={{
                border: `4px solid ${theme.ink}`,
                borderRadius: 14,
                background: isActive ? phase.color : theme.base,
                color:
                  isActive && phase.color === theme.red
                    ? theme.white
                    : theme.ink,
                padding: "14px 12px",
                textAlign: "center",
                fontFamily: fontStack,
                fontSize: isActive ? 28 : 25,
                boxShadow: isActive ? `7px 7px 0 ${theme.ink}` : "none",
                transform: `translateY(${isActive ? -6 : 0}px) scale(${isActive ? 1.04 : 1})`,
              }}
            >
              {phase.label}
            </div>
          );

          if (index === coreLoopPhases.length - 1) {
            return [phaseNode];
          }

          return [
            phaseNode,
            <div
              key={`${phase.label}-arrow`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: isPast ? 1 : 0.42,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 6,
                  border: `3px solid ${theme.ink}`,
                  background: isPast ? theme.ink : theme.base,
                }}
              />
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderTop: "12px solid transparent",
                  borderBottom: "12px solid transparent",
                  borderLeft: `18px solid ${theme.ink}`,
                  marginLeft: -2,
                }}
              />
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

function CoreLoop({
  backgroundFrameOffset = 0,
}: {
  backgroundFrameOffset?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fullPrompt =
    "orange rocket above\nfloating islands, bright ocean,\ngame-show style.";
  const typedLength = Math.floor(
    interpolate(frame, [3.35 * fps, 6.05 * fps], [0, fullPrompt.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const promptText = fullPrompt.slice(0, typedLength);
  const generateProgress = localProgress(frame, fps, 6.4, 7.45);
  const generatedPop = popScale(frame, fps, 7.45);
  const scorePop = popScale(frame, fps, 8.55);
  const isGenerating = frame > 6.25 * fps && frame < 7.55 * fps;
  const hasGenerated = frame >= 7.55 * fps;
  const hasScore = frame >= 8.55 * fps;

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1} frameOffset={backgroundFrameOffset} />
      <div
        style={{
          position: "absolute",
          top: 230,
          left: 80,
          right: 80,
          display: "grid",
          gridTemplateColumns: "520px 1fr 520px",
          gap: 28,
          alignItems: "start",
        }}
      >
        <div
          style={{
            position: "relative",
            transform: `translateY(${Math.sin(frame / 11) * 4}px)`,
          }}
        >
          <ArtCard variant="target" label="Target Image" highlight />
        </div>

        <div
          style={{
            ...card,
            background: theme.yellow,
            padding: 28,
            minHeight: 560,
          }}
        >
          <div
            style={{
              fontFamily: fontStack,
              fontSize: 50,
              lineHeight: 1,
              marginBottom: 22,
            }}
          >
            Write your best prompt!
          </div>
          <PromptEditor text={promptText} />
          <button
            type="button"
            style={{
              marginTop: 28,
              width: "100%",
              border: `6px solid ${theme.ink}`,
              borderRadius: 16,
              background:
                hasScore || hasGenerated
                  ? theme.green
                  : isGenerating
                    ? theme.red
                    : theme.blue,
              color:
                hasScore || hasGenerated || isGenerating
                  ? theme.white
                  : theme.ink,
              boxShadow: `10px 10px 0 ${theme.ink}`,
              padding: "20px 24px",
              fontFamily: fontStack,
              fontSize: 42,
            }}
          >
            {hasScore
              ? "Scored!"
              : hasGenerated
                ? "Generated!"
                : isGenerating
                  ? "Generating..."
                  : "Generate Image"}
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <div style={{ opacity: hasGenerated ? 1 : 0.22 }}>
            <div
              style={{
                transform: `scale(${hasGenerated ? generatedPop : 1})`,
              }}
            >
              <ArtCard
                variant="winner"
                label="Your Generated Image"
                highlight
              />
            </div>
          </div>
          {!hasGenerated ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                ...card,
                background: "rgba(255,255,255,0.88)",
                display: "grid",
                placeItems: "center",
                gap: 18,
                minHeight: 310,
              }}
            >
              {isGenerating ? (
                <div
                  style={{ display: "grid", justifyItems: "center", gap: 18 }}
                >
                  <Spinner size={96} color={theme.red} />
                  <div style={{ fontFamily: fontStack, fontSize: 40 }}>
                    Generating...
                  </div>
                  <div
                    style={{
                      width: 300,
                      height: 26,
                      border: `4px solid ${theme.ink}`,
                      background: theme.white,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${generateProgress * 100}%`,
                        background: theme.green,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontFamily: fontStack,
                    fontSize: 44,
                    color: theme.ink,
                    opacity: 0.45,
                  }}
                >
                  Result
                </div>
              )}
            </div>
          ) : null}
          {hasScore ? (
            <div
              style={{
                position: "absolute",
                right: -18,
                top: 312,
                transform: `rotate(5deg) scale(${scorePop})`,
              }}
            >
              <Stamp color={theme.yellow} style={{ fontSize: 46 }}>
                92 pts
              </Stamp>
            </div>
          ) : null}
        </div>
      </div>
      <GameLoopProgress />
    </AbsoluteFill>
  );
}

function ReactionPanel({
  player,
  mood,
  title,
  note,
  highlight = false,
  accent,
  delay,
}: {
  player: Player;
  mood: AvatarMood;
  title: string;
  note: string;
  highlight?: boolean;
  accent?: string;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = popScale(frame, fps, delay);

  return (
    <div
      style={{
        ...card,
        position: "relative",
        background: highlight ? theme.yellow : theme.white,
        padding: "16px 18px",
        display: "grid",
        gridTemplateColumns: "96px minmax(0, 1fr)",
        alignItems: "center",
        gap: 16,
        transform: `scale(${enter}) rotate(${highlight ? -1.5 : 1.2}deg)`,
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {highlight ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.25,
            background:
              "repeating-linear-gradient(-12deg, transparent 0 16px, rgba(255,255,255,0.9) 16px 28px)",
          }}
        />
      ) : null}
      {accent ? (
        <Stamp
          color={mood === "shocked" ? theme.red : theme.white}
          style={{
            position: "absolute",
            right: 14,
            top: 10,
            color: mood === "shocked" ? theme.white : theme.ink,
            fontSize: 18,
            padding: "7px 12px",
            boxShadow: `4px 4px 0 ${theme.ink}`,
            transform: `rotate(${mood === "shocked" ? 8 : -5}deg)`,
            zIndex: 3,
          }}
        >
          {accent}
        </Stamp>
      ) : null}
      <div style={{ position: "relative", zIndex: 1 }}>
        <PlayerAvatar
          player={player}
          size={mood === "shocked" ? 94 : 86}
          mood={mood}
        />
      </div>
      <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: fontStack,
            fontSize: 28,
            lineHeight: 1,
          }}
        >
          {player.name}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: fontStack,
            fontSize: 25,
            lineHeight: 1.05,
            color: highlight ? theme.red : theme.ink,
            overflowWrap: "break-word",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: monoFont,
            fontSize: 16,
            fontWeight: 900,
            lineHeight: 1.22,
            overflowWrap: "break-word",
          }}
        >
          {note}
        </div>
      </div>
    </div>
  );
}

const battleReactions = [
  { text: "YES!!", color: theme.green, textColor: theme.white },
  { text: "SO CLOSE!", color: theme.blue, textColor: theme.white },
  { text: "SUSHI!?", color: theme.red, textColor: theme.white },
  { text: "NOOO!", color: theme.base, textColor: theme.ink },
] as const;

function BattleResultCard({
  player,
  index,
}: {
  player: Player;
  index: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = popScale(frame, fps, 0.72 + index * 0.1);
  const scoreIn = localProgress(
    frame,
    fps,
    1.45 + index * 0.08,
    1.7 + index * 0.08,
  );
  const reactionIn = localProgress(
    frame,
    fps,
    2.25 + index * 0.13,
    2.55 + index * 0.13,
  );
  const reactionPop = popScale(frame, fps, 2.25 + index * 0.13);
  const isWinner = index === 0;
  const reactionCheer = isWinner
    ? localProgress(frame, fps, 2.25 + index * 0.13, 3.25 + index * 0.13)
    : 0;
  const avatarCheer = Math.sin(reactionCheer * Math.PI);
  const reaction = battleReactions[index] ?? battleReactions[0];

  return (
    <div
      style={{
        ...card,
        position: "relative",
        display: "grid",
        gridTemplateColumns: "300px 1fr",
        minHeight: 300,
        overflow: "hidden",
        background: isWinner ? theme.yellow : theme.white,
        transform: `scale(${enter}) rotate(${index % 2 === 0 ? -1 : 1}deg)`,
      }}
    >
      <div
        style={{
          borderRight: `5px solid ${theme.ink}`,
          background: theme.white,
          overflow: "hidden",
        }}
      >
        <Artwork variant={player.variant} objectPosition="50% 34%" />
      </div>
      <div
        style={{
          position: "relative",
          padding: "24px 30px 24px 26px",
          display: "grid",
          alignContent: "center",
          gap: 18,
        }}
      >
        {isWinner ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.22,
              background:
                "repeating-linear-gradient(-12deg, transparent 0 18px, rgba(255,255,255,0.9) 18px 30px)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              transform: `translateY(${-22 * avatarCheer}px) scale(${1 + avatarCheer * 0.2})`,
            }}
          >
            <PlayerAvatar
              player={player}
              size={102}
              mood={isWinner ? "happy" : player.mood}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: fontStack,
                fontSize: 58,
                lineHeight: 0.92,
              }}
            >
              {player.name}
            </div>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, minHeight: 86 }}>
          <Stamp
            color={reaction.color}
            style={{
              color: reaction.textColor,
              fontSize: 58,
              lineHeight: 0.9,
              padding: "16px 18px",
              opacity: reactionIn,
              transform: `rotate(${index === 2 ? 7 : isWinner ? -4 : -2}deg) scale(${reactionPop})`,
              WebkitTextStroke:
                reaction.textColor === theme.white
                  ? `2px ${theme.ink}`
                  : undefined,
              paintOrder: "stroke fill",
            }}
          >
            {reaction.text}
          </Stamp>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 20,
          top: 18,
          border: `4px solid ${theme.ink}`,
          borderRadius: 12,
          background: theme.white,
          padding: "9px 13px",
          fontFamily: monoFont,
          fontSize: 31,
          fontWeight: 900,
          color: theme.ink,
          opacity: scoreIn,
          transform: `translateY(${(1 - scoreIn) * -12}px)`,
          zIndex: 4,
        }}
      >
        {player.score} pts
      </div>
    </div>
  );
}

function PartyCompetition() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = localProgress(frame, fps, 0.08, 0.55);
  const gridIn = localProgress(frame, fps, 0.52, 0.9);
  const confetti = localProgress(frame, fps, 2.0, 2.75);

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1.75} />
      <div style={{ ...fill, opacity: confetti * 0.85, pointerEvents: "none" }}>
        <Confetti />
      </div>
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 60,
          display: "grid",
          placeItems: "center",
          alignItems: "center",
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * -34}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fontStack,
            fontSize: 94,
            lineHeight: 0.88,
            color: theme.white,
            WebkitTextStroke: `7px ${theme.ink}`,
            paintOrder: "stroke fill",
            textShadow: `0 12px 0 ${theme.ink}`,
            whiteSpace: "nowrap",
          }}
        >
          COMPETE WITH FRIENDS!
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 196,
          bottom: 64,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 24,
          opacity: gridIn,
          transform: `translateY(${(1 - gridIn) * 38}px)`,
        }}
      >
        {players.map((player, index) => (
          <BattleResultCard key={player.name} player={player} index={index} />
        ))}
      </div>
    </AbsoluteFill>
  );
}

const modeShowcaseCards = [
  {
    key: "classic" as const,
    name: "Classic",
    tag: "See it. Write it. Score it.",
    artKey: "classic" as const,
    color: theme.yellow,
  },
  {
    key: "memory" as const,
    name: "MEMORY",
    tag: "Memorize, hide, recreate.",
    artKey: "memory" as const,
    color: theme.blue,
  },
  {
    key: "artImposter" as const,
    name: "ART IMPOSTER",
    tag: "Relay the image. Catch the drift.",
    artKey: "artImposter" as const,
    color: theme.red,
  },
  {
    key: "aha" as const,
    name: "AHA MOMENT",
    tag: "Spot the tiny change first.",
    artKey: "aha" as const,
    color: theme.green,
  },
];

function ModeTile({
  mode,
  index,
  compact = false,
  active = true,
  animateEnter = true,
  focusPulse = false,
}: {
  mode: (typeof modeShowcaseCards)[number];
  index: number;
  compact?: boolean;
  active?: boolean;
  animateEnter?: boolean;
  focusPulse?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = animateEnter ? popScale(frame, fps, 0.08 + index * 0.1) : 1;
  const focus = focusPulse && active ? popScale(frame, fps, 0.08) : 0;
  const settledScale = active ? 1 + focus * 0.04 : 0.965;
  const rotation = focusPulse && active ? 0 : index % 2 === 0 ? -1.5 : 1.5;
  const nameSize = compact
    ? mode.name.length > 10
      ? 34
      : 40
    : mode.name.length > 10
      ? 48
      : 62;

  return (
    <div
      style={{
        ...card,
        background: mode.color,
        overflow: "hidden",
        height: "100%",
        position: "relative",
        transform: `translateY(${focus * -8}px) scale(${enter * settledScale}) rotate(${rotation}deg)`,
        filter: active ? "none" : "grayscale(1) brightness(0.56)",
        opacity: active ? 1 : 0.62,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: theme.ink,
        }}
      >
        <ModeArtwork artKey={mode.artKey} fit="cover" />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, transparent 42%, rgba(16,16,16,0.38) 66%, rgba(16,16,16,0.82) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: compact ? 16 : 24,
          right: compact ? 16 : 24,
          bottom: compact ? 14 : 20,
        }}
      >
        <div
          style={{
            fontFamily: fontStack,
            fontSize: nameSize,
            lineHeight: 0.92,
            color: theme.white,
            WebkitTextStroke: `4px ${theme.ink}`,
            paintOrder: "stroke fill",
            textShadow: `0 5px 0 ${theme.ink}`,
          }}
        >
          {mode.name}
        </div>
        <div
          style={{
            marginTop: compact ? 10 : 16,
            fontFamily: monoFont,
            fontSize: compact ? 16 : 23,
            fontWeight: 900,
            lineHeight: 1.18,
            color: theme.white,
            textShadow: `0 2px 0 ${theme.ink}`,
          }}
        >
          {mode.tag}
        </div>
      </div>
    </div>
  );
}

function ModeBeatTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = localProgress(frame, fps, 0.08, 0.5);

  return (
    <div
      style={{
        position: "absolute",
        left: 78,
        right: 78,
        top: 62,
        opacity: enter,
        transform: `translateY(${(1 - enter) * -36}px)`,
      }}
    >
      <div
        style={{
          fontFamily: fontStack,
          fontSize: 102,
          lineHeight: 0.88,
          color: theme.white,
          WebkitTextStroke: `7px ${theme.ink}`,
          paintOrder: "stroke fill",
          textShadow: `0 12px 0 ${theme.ink}`,
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 18,
          fontFamily: fontStack,
          fontSize: 37,
          lineHeight: 1,
          color: theme.yellow,
          WebkitTextStroke: `3px ${theme.ink}`,
          paintOrder: "stroke fill",
          textShadow: `0 5px 0 ${theme.ink}`,
          textTransform: "uppercase",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

function ModeSelectSlam({ activeMode }: { activeMode?: ModeArtKey }) {
  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <div
        style={{
          ...fill,
          background:
            "linear-gradient(90deg, rgba(16,16,16,0.55), transparent 45%, rgba(16,16,16,0.4))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 62,
          right: 62,
          top: 58,
          bottom: 58,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 28,
        }}
      >
        {modeShowcaseCards.map((mode, index) => (
          <ModeTile
            key={mode.name}
            mode={mode}
            index={index}
            active={!activeMode || mode.key === activeMode}
            animateEnter={!activeMode}
            focusPulse={Boolean(activeMode)}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
}

function MiniBattleStrip({
  variant,
  style,
}: {
  variant: "classic" | "memory";
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows =
    variant === "classic"
      ? [
          {
            player: players[0],
            mood: "happy" as AvatarMood,
            text: "",
            score: 92,
          },
          {
            player: players[1],
            mood: "focused" as AvatarMood,
            text: "",
            score: 88,
          },
          {
            player: players[2],
            mood: "focused" as AvatarMood,
            text: "",
            score: 74,
          },
          {
            player: players[3],
            mood: "shocked" as AvatarMood,
            text: "",
            score: 69,
          },
        ]
      : [
          {
            player: players[0],
            mood: "focused" as AvatarMood,
            text: "Remembering",
            score: 84,
          },
          {
            player: players[1],
            mood: "happy" as AvatarMood,
            text: "Got the colors",
            score: 91,
          },
          {
            player: players[2],
            mood: "shocked" as AvatarMood,
            text: "Forgot one bit",
            score: 71,
          },
          {
            player: players[3],
            mood: "focused" as AvatarMood,
            text: "Typing fast",
            score: 80,
          },
        ];
  const panelIn =
    variant === "memory" ? localProgress(frame, fps, 2.42, 2.72) : 1;

  return (
    <div
      style={{
        ...card,
        position: "absolute",
        background: theme.white,
        padding: "16px 18px",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
        opacity: panelIn,
        transform: `translateY(${(1 - panelIn) * 18}px)`,
        ...style,
      }}
    >
      {rows.map((row, index) => {
        const enterStart = variant === "memory" ? 2.52 : 0.35;
        const enter = localProgress(
          frame,
          fps,
          enterStart + index * 0.1,
          enterStart + 0.35 + index * 0.1,
        );
        const noteIn =
          variant === "memory"
            ? localProgress(frame, fps, 2.7 + index * 0.08, 3.02 + index * 0.08)
            : 1;
        const winnerIndex = variant === "memory" ? 1 : 0;
        const scoreStart = variant === "memory" ? 4.92 : 3.0;
        const scoreIn = localProgress(
          frame,
          fps,
          scoreStart + index * 0.08,
          scoreStart + 0.27 + index * 0.08,
        );
        const scoreCheer =
          index === winnerIndex
            ? localProgress(
                frame,
                fps,
                scoreStart + index * 0.08,
                scoreStart + 1.15 + index * 0.08,
              )
            : 0;
        const avatarCheer = Math.sin(scoreCheer * Math.PI);

        return (
          <div
            key={row.player.name}
            style={{
              border: `4px solid ${theme.ink}`,
              borderRadius: 14,
              background: index === winnerIndex ? theme.yellow : theme.base,
              padding: "12px 14px",
              display: "grid",
              gridTemplateColumns: "62px 1fr",
              gap: 12,
              alignItems: "center",
              opacity: enter,
              transform: `translateY(${(1 - enter) * 24}px)`,
            }}
          >
            <div
              style={{
                transform: `translateY(${-16 * avatarCheer}px) scale(${1 + avatarCheer * 0.18})`,
              }}
            >
              <PlayerAvatar player={row.player} size={58} mood={row.mood} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: fontStack,
                    fontSize: 28,
                    lineHeight: 1,
                  }}
                >
                  {row.player.name}
                </div>
                <div
                  style={{
                    fontFamily: monoFont,
                    fontSize: 29,
                    lineHeight: 1,
                    fontWeight: 900,
                    color: theme.ink,
                    opacity: scoreIn,
                  }}
                >
                  {row.score}
                </div>
              </div>
              {row.text ? (
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: fontStack,
                    fontSize: 20,
                    lineHeight: 1,
                    color:
                      variant === "memory" && index === 2
                        ? theme.red
                        : theme.ink,
                    opacity: noteIn,
                    transform: `translateY(${(1 - noteIn) * 10}px)`,
                  }}
                >
                  {row.text}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClassicModeBeat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const prompt = "orange rocket above floating islands, bright ocean".slice(
    0,
    Math.floor(
      interpolate(frame, [1.5 * fps, 2.9 * fps], [0, 50], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    ),
  );
  const result = localProgress(frame, fps, 3.0, 3.5);

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1.2} />
      <ModeBeatTitle
        title="CLASSIC"
        subtitle="See it. Guess it. Generate it."
      />
      <div
        style={{
          position: "absolute",
          left: 86,
          right: 86,
          top: 222,
          bottom: 214,
          display: "grid",
          gridTemplateColumns: "1fr 1.1fr 1fr",
          gap: 30,
          alignItems: "center",
        }}
      >
        <ArtCard variant="target" label="1. Observe" highlight />
        <div
          style={{
            ...card,
            background: theme.yellow,
            padding: 30,
            transform: "rotate(-1deg)",
          }}
        >
          <div style={{ fontFamily: fontStack, fontSize: 58 }}>2. Write</div>
          <div style={{ marginTop: 24 }}>
            <PromptEditor text={prompt} compact />
          </div>
          <Stamp color={theme.blue} style={{ marginTop: 24, fontSize: 30 }}>
            Generate
          </Stamp>
        </div>
        <div style={{ position: "relative" }}>
          <div style={{ transform: `scale(${0.92 + result * 0.08})` }}>
            <ArtCard variant="winner" label="3. Score" highlight />
          </div>
          {result < 1 ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                ...card,
                background: "rgba(255,255,255,0.9)",
                display: "grid",
                placeItems: "center",
                minHeight: 310,
                opacity: 1 - result,
                zIndex: 2,
              }}
            >
              <div
                style={{
                  fontFamily: fontStack,
                  fontSize: 52,
                  color: theme.ink,
                  opacity: 0.44,
                }}
              >
                Result
              </div>
            </div>
          ) : null}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: theme.white,
              opacity: 1 - result,
              mixBlendMode: "saturation",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
        </div>
      </div>
      <MiniBattleStrip
        variant="classic"
        style={{
          left: 92,
          right: 92,
          bottom: 52,
        }}
      />
    </AbsoluteFill>
  );
}

function MemoryModeBeat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hide = localProgress(frame, fps, 2.0, 2.45);
  const prompt =
    "orange rocket, bright ocean, floating islands, blue sky".slice(
      0,
      Math.floor(
        interpolate(frame, [3.0 * fps, 4.75 * fps], [0, 56], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      ),
    );

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1.5} />
      <ModeBeatTitle title="MEMORY" subtitle="Memorize image within seconds" />
      <div
        style={{
          position: "absolute",
          left: 112,
          top: 245,
          width: 760,
          height: 560,
          ...card,
          background: theme.white,
          padding: 18,
          overflow: "hidden",
        }}
      >
        <Artwork variant="target" />
        <div
          style={{
            ...fill,
            opacity: hide * 0.86,
            background: "rgba(16,16,16,0.72)",
          }}
        />
        {Array.from({ length: 9 }).map((_, index) => (
          <div
            key={index}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${index * 11.2}%`,
              width: "12%",
              background: index % 2 === 0 ? theme.ink : theme.purple,
              borderRight: `4px solid ${theme.ink}`,
              transform: `translateY(${-100 + hide * 100}%)`,
            }}
          />
        ))}
        <Stamp
          color={theme.red}
          style={{
            position: "absolute",
            left: 170,
            top: 240,
            color: theme.white,
            fontSize: 42,
            opacity: hide,
            transform: `rotate(-5deg) scale(${0.8 + hide * 0.2})`,
          }}
        >
          image hidden
        </Stamp>
      </div>
      <div
        style={{
          position: "absolute",
          right: 110,
          top: 322,
          width: 760,
          ...card,
          background: theme.yellow,
          padding: 30,
          transform: "rotate(1.5deg)",
        }}
      >
        <div style={{ fontFamily: fontStack, fontSize: 54 }}>
          Recreate without looking
        </div>
        <div style={{ marginTop: 24 }}>
          <PromptEditor text={prompt} compact />
        </div>
      </div>
      <MiniBattleStrip
        variant="memory"
        style={{
          right: 110,
          bottom: 70,
          width: 760,
          gridTemplateColumns: "1fr 1fr",
        }}
      />
    </AbsoluteFill>
  );
}

const relayCards: Array<{
  label: string;
  variant: ArtVariant;
  color: string;
  player?: Player;
}> = [
  { label: "Original", variant: "target", color: theme.yellow },
  { label: "Aoi", variant: "near", color: theme.blue, player: players[0] },
  { label: "Ren", variant: "winner", color: theme.green, player: players[1] },
  { label: "Mika", variant: "chaos", color: theme.red, player: players[2] },
  { label: "Jun", variant: "miss", color: theme.base, player: players[3] },
];

const imposterVotes = [
  { voter: players[0], target: "Mika", delay: 3.25 },
  { voter: players[1], target: "Mika", delay: 3.55 },
  { voter: players[2], target: "Jun", delay: 3.85 },
  { voter: players[3], target: "Mika", delay: 4.15 },
];

function ArtImposterModeBeat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = localProgress(frame, fps, 4.35, 5.1);
  const votePanel = localProgress(frame, fps, 3.0, 3.35);

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1.9} />
      <div
        style={{
          ...fill,
          background:
            "linear-gradient(120deg, rgba(255,59,48,0.32), transparent 48%, rgba(16,16,16,0.52))",
        }}
      />
      <ModeBeatTitle title="ART IMPOSTER" subtitle="Guess who sabotaged the art?" />
      <div
        style={{
          position: "absolute",
          left: 62,
          right: 62,
          top: 245,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 18,
        }}
      >
        {relayCards.map((item, index) => {
          const enter = popScale(frame, fps, 0.05 + index * 0.12);
          const isImposter = item.label === "Mika";

          return (
            <div
              key={item.label}
              style={{
                ...card,
                position: "relative",
                background: item.color,
                overflow: "hidden",
                transform: `scale(${enter}) rotate(${index % 2 === 0 ? -1.2 : 1.2}deg)`,
              }}
            >
              <div
                style={{
                  height: 240,
                  borderBottom: `5px solid ${theme.ink}`,
                  background: theme.white,
                  overflow: "hidden",
                }}
              >
                <Artwork variant={item.variant} />
              </div>
              <div
                style={{
                  padding: "18px 18px 22px",
                  minHeight: 128,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontFamily: fontStack,
                    fontSize: 34,
                    lineHeight: 1,
                  }}
                >
                  {item.player ? (
                    <PlayerAvatar player={item.player} size={42} />
                  ) : null}
                  {item.label}
                </div>
              </div>
              {isImposter ? (
                <Stamp
                  color={theme.red}
                  style={{
                    position: "absolute",
                    left: 20,
                    top: 102,
                    color: theme.white,
                    fontSize: 28,
                    opacity: reveal,
                    transform: `rotate(-10deg) scale(${0.78 + reveal * 0.22})`,
                  }}
                >
                  IMPOSTER
                </Stamp>
              ) : null}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 270,
          right: 270,
          bottom: 70,
          ...card,
          background: theme.white,
          padding: "20px 24px",
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          alignItems: "stretch",
          gap: 20,
          opacity: votePanel,
          transform: `translateY(${(1 - votePanel) * 34}px)`,
        }}
      >
        <div style={{ fontFamily: fontStack, fontSize: 54 }}>
          VOTE THE IMPOSTER
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          {players.map((player) => (
            <div
              key={player.name}
              style={{
                border: `4px solid ${theme.ink}`,
                borderRadius: 14,
                background: player.name === "Mika" ? theme.red : theme.base,
                minHeight: 118,
                padding: "10px 8px",
                display: "grid",
                gridTemplateRows: "32px 1fr",
                justifyItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: fontStack,
                  fontSize: 20,
                  color: player.name === "Mika" ? theme.white : theme.ink,
                  WebkitTextStroke:
                    player.name === "Mika" ? `2px ${theme.ink}` : undefined,
                  paintOrder: "stroke fill",
                }}
              >
                {player.name}
              </div>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 58,
                }}
              >
                {imposterVotes
                  .filter((vote) => vote.target === player.name)
                  .map((vote, voteIndex) => {
                    const voteIn = localProgress(
                      frame,
                      fps,
                      vote.delay,
                      vote.delay + 0.22,
                    );

                    return (
                      <div
                        key={`${vote.voter.name}-${player.name}`}
                        style={{
                          position: "absolute",
                          left: 16 + voteIndex * 30,
                          top: 5 + (voteIndex % 2) * 16,
                          opacity: voteIn,
                          transform: `translateY(${(1 - voteIn) * -22}px) scale(${0.75 + voteIn * 0.25})`,
                        }}
                      >
                        <PlayerAvatar
                          player={vote.voter}
                          size={42}
                          mood={
                            vote.voter.name === "Mika" ? "shocked" : "focused"
                          }
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function AhaSpotPreview({
  src,
  label,
  accent,
}: {
  src: string;
  label: string;
  accent: string;
}) {
  return (
    <div
      style={{
        border: `5px solid ${theme.ink}`,
        borderRadius: 14,
        background: theme.white,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 138,
          backgroundImage: `url(${staticFile(src)})`,
          backgroundSize: "330%",
          backgroundPosition: "58% 43%",
          borderBottom: `4px solid ${theme.ink}`,
        }}
      />
      <div
        style={{
          background: accent,
          padding: "10px 14px",
          fontFamily: fontStack,
          fontSize: 25,
          color: accent === theme.red ? theme.white : theme.ink,
          WebkitTextStroke:
            accent === theme.red ? `2px ${theme.ink}` : undefined,
          paintOrder: "stroke fill",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SearchMarker({
  player,
  left,
  top,
  delay,
}: {
  player: Player;
  left: string;
  top: string;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = localProgress(frame, fps, delay, delay + 0.35);
  const pulse = 0.5 + Math.sin(frame / 7 + delay * 5) * 0.5;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        opacity: enter,
        transform: `translate(-50%, -50%) scale(${0.86 + enter * 0.14})`,
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 34,
          top: 34,
          width: 118 + pulse * 28,
          height: 118 + pulse * 28,
          border: `6px solid ${player.color}`,
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.28 + pulse * 0.32,
        }}
      />
      <PlayerAvatar player={player} size={68} mood="focused" />
    </div>
  );
}

function AhaModeBeat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const change = clamp(
    interpolate(frame, [2.4 * fps, 6.4 * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const answer = localProgress(frame, fps, 6.65, 7.45);
  const click = popScale(frame, fps, 6.7);

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1.25} />
      <ModeBeatTitle title="AHA MOMENT" subtitle="Find where it's changing" />
      <div
        style={{
          position: "absolute",
          left: 94,
          top: 230,
          width: 1120,
          height: 618,
          ...card,
          background: theme.white,
          padding: 18,
          overflow: "hidden",
        }}
      >
        <Img
          src={staticFile(ahaBeforeSource)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 44%",
          }}
        />
        <div
          style={{
            ...fill,
            padding: 18,
            opacity: change,
          }}
        >
          <Img
            src={staticFile(ahaAfterSource)}
            style={{
              width: "calc(100% + 12px)",
              height: "100%",
              objectFit: "cover",
              objectPosition: "50% 44%",
              transform: "translateX(-6px)",
            }}
          />
        </div>
        {[
          { player: players[0], left: "29%", top: "64%", delay: 0.1 },
          { player: players[1], left: "47%", top: "35%", delay: 0.16 },
          { player: players[2], left: "72%", top: "59%", delay: 0.22 },
          { player: players[3], left: "59%", top: "73%", delay: 0.28 },
        ].map((marker) => (
          <SearchMarker
            key={marker.player.name}
            player={marker.player}
            left={marker.left}
            top={marker.top}
            delay={marker.delay}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: "60%",
            top: "43%",
            width: 122,
            height: 122,
            border: `8px solid ${theme.red}`,
            borderRadius: "50%",
            transform: `translate(-50%, -50%) scale(${click})`,
            opacity: answer,
            boxShadow: `0 0 36px rgba(255,59,48,${answer})`,
            zIndex: 7,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "60%",
            top: "43%",
            width: 190,
            height: 8,
            background: theme.red,
            transform: `translate(-50%, -50%) scale(${click})`,
            opacity: answer,
            zIndex: 8,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "60%",
            top: "43%",
            width: 8,
            height: 190,
            background: theme.red,
            transform: `translate(-50%, -50%) scale(${click})`,
            opacity: answer,
            zIndex: 8,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 86,
          top: 270,
          width: 520,
          display: "grid",
          gap: 18,
        }}
      >
        {players.map((player, index) => {
          const found = answer > 0.45 && index === 0;

          return (
            <div
              key={player.name}
              style={{
                ...card,
                background: found ? theme.green : theme.white,
                padding: "16px 18px",
                display: "grid",
                gridTemplateColumns: "82px 1fr",
                gap: 18,
                alignItems: "center",
              }}
            >
              <PlayerAvatar
                player={player}
                size={74}
                mood={found ? "happy" : "focused"}
              />
              <div>
                <div
                  style={{
                    fontFamily: fontStack,
                    fontSize: 35,
                    lineHeight: 1,
                  }}
                >
                  {player.name}
                </div>
                <div
                  style={{
                    marginTop: 7,
                    fontFamily: fontStack,
                    fontSize: 31,
                    lineHeight: 1,
                    color: found ? theme.white : theme.ink,
                    WebkitTextStroke: found ? `2px ${theme.ink}` : undefined,
                    paintOrder: "stroke fill",
                  }}
                >
                  {found ? "FOUND IT!" : "SEARCHING..."}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 300,
          bottom: 52,
          width: 760,
          ...card,
          background: theme.yellow,
          padding: 18,
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 16,
          alignItems: "center",
          opacity: answer,
          transform: `translateY(${(1 - answer) * 36}px) scale(${0.95 + answer * 0.05})`,
        }}
      >
        <AhaSpotPreview
          src={ahaBeforeSource}
          label="Before"
          accent={theme.base}
        />
        <AhaSpotPreview
          src={ahaAfterSource}
          label="Changed spot"
          accent={theme.red}
        />
        <Stamp
          color={theme.green}
          style={{
            color: theme.white,
            fontSize: 34,
            transform: `rotate(5deg) scale(${click})`,
          }}
        >
          Aoi +100
        </Stamp>
      </div>
    </AbsoluteFill>
  );
}

function ModeRecapBeat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headline = localProgress(frame, fps, 0.08, 0.5);
  const more = popScale(frame, fps, 2.05);

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={2.1} />
      <Confetti />
      <div
        style={{
          position: "absolute",
          left: 78,
          top: 58,
          right: 78,
          fontFamily: fontStack,
          fontSize: 76,
          lineHeight: 0.9,
          color: theme.white,
          WebkitTextStroke: `6px ${theme.ink}`,
          paintOrder: "stroke fill",
          textShadow: `0 10px 0 ${theme.ink}`,
          opacity: headline,
          transform: `translateY(${(1 - headline) * -28}px)`,
          textAlign: "center",
        }}
      >
        FIND YOUR FAVORITE GAME MODE
      </div>
      <div
        style={{
          position: "absolute",
          left: 62,
          right: 62,
          top: 152,
          bottom: 54,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 26,
        }}
      >
        {modeShowcaseCards.map((mode, index) => (
          <ModeTile key={mode.name} mode={mode} index={index} />
        ))}
      </div>
      <Stamp
        color={theme.red}
        style={{
          position: "absolute",
          right: 62,
          bottom: 52,
          color: theme.white,
          fontSize: 58,
          padding: "18px 28px",
          transform: `rotate(-7deg) scale(${more})`,
          zIndex: 4,
        }}
      >
        ...and more!!
      </Stamp>
    </AbsoluteFill>
  );
}

function ModeShowcase({
  backgroundFrameOffset = 0,
}: {
  backgroundFrameOffset?: number;
}) {
  return (
    <AbsoluteFill>
      <SceneBackground energy={1.8} frameOffset={backgroundFrameOffset} />
      <Sequence from={0} durationInFrames={f(2.8)} premountFor={f(0.5)}>
        <ModeSelectSlam />
      </Sequence>
      <Sequence from={f(2.8)} durationInFrames={f(2.6)} premountFor={f(0.5)}>
        <ModeSelectSlam activeMode="classic" />
      </Sequence>
      <Sequence from={f(5.4)} durationInFrames={f(6.0)} premountFor={f(0.5)}>
        <ClassicModeBeat />
      </Sequence>
      <Sequence from={f(11.4)} durationInFrames={f(2.2)} premountFor={f(0.5)}>
        <ModeSelectSlam activeMode="memory" />
      </Sequence>
      <Sequence from={f(13.6)} durationInFrames={f(7.4)} premountFor={f(0.5)}>
        <MemoryModeBeat />
      </Sequence>
      <Sequence from={f(21.0)} durationInFrames={f(2.2)} premountFor={f(0.5)}>
        <ModeSelectSlam activeMode="artImposter" />
      </Sequence>
      <Sequence from={f(23.2)} durationInFrames={f(8.4)} premountFor={f(0.5)}>
        <ArtImposterModeBeat />
      </Sequence>
      <Sequence from={f(31.6)} durationInFrames={f(1.8)} premountFor={f(0.5)}>
        <ModeSelectSlam activeMode="aha" />
      </Sequence>
      <Sequence from={f(33.4)} durationInFrames={f(9.6)} premountFor={f(0.5)}>
        <AhaModeBeat />
      </Sequence>
      <Sequence from={f(43.0)} durationInFrames={f(4.5)} premountFor={f(0.5)}>
        <ModeRecapBeat />
      </Sequence>
    </AbsoluteFill>
  );
}

function Confetti() {
  const frame = useCurrentFrame();
  const colors = [
    theme.red,
    theme.blue,
    theme.yellow,
    theme.green,
    theme.white,
  ];

  return (
    <div style={fill}>
      {Array.from({ length: 54 }).map((_, index) => {
        const left = (index * 137) % 1920;
        const delay = (index % 9) * 5;
        const y = ((frame + delay) * (6 + (index % 5))) % 1180;
        const rotate = frame * (index % 2 === 0 ? 8 : -7) + index * 19;

        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left,
              top: y - 100,
              width: 26 + (index % 3) * 8,
              height: 14,
              background: colors[index % colors.length],
              border: `3px solid ${theme.ink}`,
              transform: `rotate(${rotate}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

function Results() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ fontFamily: bodyFont }}>
      <SceneBackground energy={1} />
      <Confetti />

      <div
        style={{
          position: "absolute",
          left: 96,
          top: 112,
          width: 560,
          ...card,
          background: theme.yellow,
          padding: 28,
          transform: "rotate(-2deg)",
        }}
      >
        <div style={{ fontFamily: fontStack, fontSize: 44 }}>WINNER</div>
        <div style={{ marginTop: 14 }}>
          <ArtCard variant="winner" label="Aoi" score={92} highlight />
        </div>
        <div
          style={{
            marginTop: 22,
            ...card,
            background: theme.white,
            padding: "18px 20px",
            fontFamily: fontStack,
            fontSize: 34,
            textAlign: "center",
          }}
        >
          Total 248 pts
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 720,
          right: 88,
          top: 112,
          ...card,
          background: theme.white,
          padding: 34,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: fontStack,
            fontSize: 74,
            lineHeight: 1,
          }}
        >
          Round 1 Results
        </h2>
        <div style={{ marginTop: 32, display: "grid", gap: 18 }}>
          {players
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((player, index) => {
              const enter = localProgress(
                frame,
                fps,
                1 + index * 0.42,
                1.35 + index * 0.42,
              );
              return (
                <div
                  key={player.name}
                  style={{
                    border: `5px solid ${theme.ink}`,
                    borderRadius: 18,
                    background: index === 0 ? theme.yellow : theme.base,
                    padding: "16px 22px",
                    display: "grid",
                    gridTemplateColumns: "78px 1fr 170px",
                    alignItems: "center",
                    gap: 18,
                    opacity: enter,
                    transform: `translateX(${(1 - enter) * 60}px)`,
                  }}
                >
                  <div style={{ fontFamily: fontStack, fontSize: 42 }}>
                    #{index + 1}
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 18 }}
                  >
                    <PlayerAvatar
                      player={player}
                      size={66}
                      mood={index === 0 ? "happy" : player.mood}
                    />
                    <div>
                      <div style={{ fontFamily: fontStack, fontSize: 36 }}>
                        {player.name}
                      </div>
                      <div
                        style={{
                          fontFamily: monoFont,
                          fontSize: 20,
                          fontWeight: 900,
                        }}
                      >
                        best prompt locked in
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      border: `4px solid ${theme.ink}`,
                      borderRadius: 12,
                      background: theme.white,
                      padding: "12px 14px",
                      textAlign: "right",
                      fontFamily: monoFont,
                      fontSize: 31,
                      fontWeight: 900,
                    }}
                  >
                    {player.score} pts
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function ClosingCta() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = popScale(frame, fps, 0.3);
  const tagline = localProgress(frame, fps, 1.7, 2.35);
  const qrReveal = localProgress(frame, fps, 2.55, 3.35);
  const qrCards = [
    {
      label: "Play the game",
      src: gameplayQrSource,
      color: theme.yellow,
    },
    {
      label: "Project page",
      src: projectPageQrSource,
      color: theme.blue,
    },
  ];

  return (
    <AbsoluteFill
      style={{ background: theme.ink, color: theme.white, overflow: "hidden" }}
    >
      <Img
        src={staticFile(partyHeroSource)}
        style={{
          ...fill,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.64,
          transform: `scale(${1.03 + localProgress(frame, fps, 0, 10) * 0.04})`,
        }}
      />
      <div
        style={{
          ...fill,
          background:
            "linear-gradient(180deg, rgba(16,16,16,0.35), rgba(16,16,16,0.88))",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          padding: "0 120px",
        }}
      >
        <div
          style={{
            transform: `translateY(${-118 * qrReveal}px)`,
          }}
        >
          <div
            style={{
              display: "inline-block",
              transform: `scale(${logo}) rotate(${Math.sin(frame / 14) * 1.2}deg)`,
              transformOrigin: "center",
            }}
          >
            <div
              style={{
                fontFamily: fontStack,
                fontSize: 156,
                lineHeight: 0.9,
                letterSpacing: 0,
                color: theme.white,
                textShadow: `12px 12px 0 ${theme.ink}`,
              }}
            >
              Promp<span style={{ color: theme.yellow }}>Dojo</span>
            </div>
          </div>
          <div
            style={{
              marginTop: 42,
              fontFamily: fontStack,
              fontSize: 62,
              lineHeight: 1.2,
              opacity: tagline,
              transform: `translateY(${(1 - tagline) * 28}px)`,
            }}
          >
            See it. Guess it. Generate it.
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 76,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 36,
          opacity: qrReveal,
          transform: `translateX(-50%) translateY(${(1 - qrReveal) * 42}px) scale(${0.94 + qrReveal * 0.06})`,
        }}
      >
        {qrCards.map((qr) => (
          <div
            key={qr.label}
            style={{
              ...card,
              width: 326,
              background: qr.color,
              padding: 18,
            }}
          >
            <div
              style={{
                border: `5px solid ${theme.ink}`,
                background: theme.white,
                width: 244,
                height: 244,
                margin: "0 auto",
                display: "grid",
                placeItems: "center",
                padding: 16,
                overflow: "hidden",
              }}
            >
              <Img
                src={staticFile(qr.src)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  imageRendering: "pixelated",
                }}
              />
            </div>
            <div
              style={{
                marginTop: 13,
                fontFamily: fontStack,
                fontSize: 28,
                lineHeight: 1,
                textAlign: "center",
                color: qr.color === theme.blue ? theme.white : theme.ink,
                WebkitTextStroke:
                  qr.color === theme.blue ? `2px ${theme.ink}` : undefined,
                paintOrder: "stroke fill",
              }}
            >
              {qr.label}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function PrompDojoAudioLayer() {
  return (
    <>
      <Audio
        src={staticFile(prompDojoMusicSource)}
        durationInFrames={PROMPDOJO_DURATION_FRAMES}
        volume={(frame) =>
          interpolate(frame, [0, f(1.2)], [0, 0.48], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      {prompDojoAudioCues.map((cue) => (
        <Audio
          key={cue.id}
          src={staticFile(cue.src)}
          from={f(cue.at)}
          durationInFrames={
            cue.durationSeconds === undefined
              ? undefined
              : f(cue.durationSeconds)
          }
          playbackRate={cue.playbackRate}
          trimBefore={
            cue.trimStartSeconds === undefined
              ? undefined
              : f(cue.trimStartSeconds)
          }
          trimAfter={
            cue.durationSeconds === undefined ||
            cue.trimStartSeconds === undefined
              ? undefined
              : f(cue.trimStartSeconds + cue.durationSeconds)
          }
          volume={cue.volume}
        />
      ))}
    </>
  );
}

export function PrompDojoIntro() {
  const coldOpenSeconds = 10.5;
  const titleHitSeconds = 5.0;
  const gameLoopTitleSeconds = 1.5;
  const coreLoopSeconds = 10.8;
  const partyTitleSeconds = 0;
  const partyCompetitionSeconds = 6.2;
  const modesTitleSeconds = 1.5;
  const modeShowcaseSeconds = 47.5;
  const closingCtaSeconds = 7.8;
  const titleHitStart = coldOpenSeconds;
  const gameLoopTitleStart = titleHitStart + titleHitSeconds;
  const coreLoopStart = gameLoopTitleStart + gameLoopTitleSeconds;
  const partyCompetitionStart =
    coreLoopStart + coreLoopSeconds + partyTitleSeconds;
  const modesTitleStart = partyCompetitionStart + partyCompetitionSeconds;
  const modeShowcaseStart = modesTitleStart + modesTitleSeconds;
  const closingCtaStart = modeShowcaseStart + modeShowcaseSeconds;

  return (
    <AbsoluteFill style={{ background: theme.base }}>
      <PrompDojoAudioLayer />
      <Sequence
        from={0}
        durationInFrames={f(coldOpenSeconds)}
        premountFor={f(1)}
      >
        <ColdOpen />
      </Sequence>
      <Sequence
        from={f(titleHitStart)}
        durationInFrames={f(titleHitSeconds)}
        premountFor={f(1)}
      >
        <TitleHit />
      </Sequence>
      <Sequence
        from={f(gameLoopTitleStart)}
        durationInFrames={f(gameLoopTitleSeconds)}
        premountFor={f(1)}
      >
        <ChapterTitle
          title="GAME LOOP"
          backgroundFrameOffset={f(gameLoopTitleStart)}
          backgroundEnergy={1}
        />
      </Sequence>
      <Sequence
        from={f(coreLoopStart)}
        durationInFrames={f(coreLoopSeconds)}
        premountFor={f(1)}
      >
        <CoreLoop backgroundFrameOffset={f(coreLoopStart)} />
      </Sequence>
      <Sequence
        from={f(partyCompetitionStart)}
        durationInFrames={f(partyCompetitionSeconds)}
        premountFor={f(1)}
      >
        <PartyCompetition />
      </Sequence>
      <Sequence
        from={f(modesTitleStart)}
        durationInFrames={f(modesTitleSeconds)}
        premountFor={f(1)}
      >
        <ChapterTitle
          title="VARIOUS GAME MODES"
          backgroundFrameOffset={f(modesTitleStart)}
          backgroundEnergy={1.8}
        />
      </Sequence>
      <Sequence
        from={f(modeShowcaseStart)}
        durationInFrames={f(modeShowcaseSeconds)}
        premountFor={f(1)}
      >
        <ModeShowcase backgroundFrameOffset={f(modeShowcaseStart)} />
      </Sequence>
      <Sequence
        from={f(closingCtaStart)}
        durationInFrames={f(closingCtaSeconds)}
        premountFor={f(1)}
      >
        <ClosingCta />
      </Sequence>
    </AbsoluteFill>
  );
}
