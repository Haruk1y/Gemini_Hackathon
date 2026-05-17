"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Gamepad2,
  Ghost,
  ImageIcon,
  ListChecks,
  LoaderCircle,
  LogOut,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Send,
  Shuffle,
  Sparkles,
  Trophy,
  type LucideIcon,
  Users,
  Vote,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { buildCurrentAppPath } from "@/lib/client/paths";
import { leaveRoom, useRoomPresence } from "@/lib/client/room-presence";
import {
  resolveUiErrorMessage,
  toUiError,
  type UiError,
} from "@/lib/i18n/errors";
import { useRoomSync } from "@/lib/client/room-sync";
import {
  CHANGE_DEFAULT_ROUND_SECONDS,
  CHANGE_ROUND_SECONDS_OPTIONS,
  getGameModeDefinition,
  getGameModeOptions,
  getChangeViewCountForRoundSeconds,
  normalizeRoundSecondsForMode,
  STANDARD_DEFAULT_ROUND_SECONDS,
  STANDARD_ROUND_SECONDS_OPTIONS,
} from "@/lib/game/modes";
import { getMaxCpuPlayersForMode } from "@/lib/game/cpu";
import type { GameMode } from "@/lib/types/game";
import type { Language } from "@/lib/i18n/language";

type ActionBusy = "ready" | "start" | "leave" | "shuffle" | null;
type SettingsStatus = "idle" | "saving" | "saved" | "error";

interface PickerOption {
  value: number;
  label: string;
  unitLabel: string;
}

interface SwipeValuePickerProps {
  label: string;
  icon: LucideIcon;
  options: readonly PickerOption[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

interface ModePreviewImages {
  target: string;
  generated: string;
}

const MODE_PREVIEW_IMAGES: Record<GameMode, ModePreviewImages> = {
  classic: {
    target: "/images/lobby/modes/classic-target.png",
    generated: "/images/lobby/modes/classic-generated.png",
  },
  memory: {
    target: "/images/lobby/modes/memory-target.png",
    generated: "/images/lobby/modes/memory-generated.png",
  },
  change: {
    target: "/images/lobby/modes/aha-before.png",
    generated: "/images/lobby/modes/aha-after.png",
  },
  impostor: {
    target: "/images/lobby/modes/impostor-relay.png",
    generated: "/images/lobby/modes/impostor-generated.png",
  },
};

const MODE_DEMO_IMAGES = {
  changeBefore: MODE_PREVIEW_IMAGES.change.target,
  changeAfter: MODE_PREVIEW_IMAGES.change.generated,
} as const;

const IMPOSTOR_RELAY_IMAGES = [
  "/images/lobby/modes/impostor-target-card.png",
  "/images/lobby/modes/impostor-crew-card.png",
  "/images/lobby/modes/impostor-impostor-card.png",
  "/images/lobby/modes/impostor-final-card.png",
] as const;

const MODE_DEMO_STEP_INTERVAL_MS = 3400;

interface ModeGameplayStep {
  badge: string;
  stepLabel?: string;
  title: string;
  body: string;
  prompt: string;
  result: string;
}

interface ModeGameplayDemo {
  stageLabel: string;
  promptLabel: string;
  outputLabel: string;
  steps: readonly ModeGameplayStep[];
}

const MODE_GAMEPLAY_DEMOS: Record<
  GameMode,
  Record<Language, ModeGameplayDemo>
> = {
  classic: {
    ja: {
      stageLabel: "お題画像",
      promptLabel: "プロンプト",
      outputLabel: "生成結果",
      steps: [
        {
          badge: "ESTIMATE",
          title: "お題プロンプトを推定",
          body: "形・色・配置を見て、AIに渡す説明文を頭の中で組み立てる。",
          prompt:
            "赤いロケット、浮かぶ島々、滝、卓上のおもちゃジオラマ",
          result: "観察中",
        },
        {
          badge: "TYPE",
          title: "プロンプトを書く",
          body: "見えている内容を、AIが再現しやすい言葉にする。",
          prompt:
            "赤いロケット、浮かぶ島々、滝、卓上のおもちゃジオラマ",
          result: "入力中",
        },
        {
          badge: "GENERATE",
          title: "画像生成",
          body: "入力したプロンプトから、AIが再現画像を生成する。",
          prompt:
            "赤いロケット、浮かぶ島々、滝、卓上のおもちゃジオラマ",
          result: "生成中",
        },
        {
          badge: "SCORE",
          title: "スコアリング",
          body: "生成画像が近いほど、高いスコアを獲得。",
          prompt:
            "赤いロケット、浮かぶ島々、滝、卓上のおもちゃジオラマ",
          result: "92 pts",
        },
      ],
    },
    en: {
      stageLabel: "Target Image",
      promptLabel: "Prompt",
      outputLabel: "Generated",
      steps: [
        {
          badge: "ESTIMATE",
          title: "Estimate Target Image Prompt",
          body: "Read the target image and build the prompt you think created it.",
          prompt:
            "red rocket, floating islands, waterfalls, tabletop toy diorama",
          result: "Estimating",
        },
        {
          badge: "TYPE",
          title: "Writing Prompt",
          body: "Turn what you see into words the image model can follow.",
          prompt:
            "red rocket, floating islands, waterfalls, tabletop toy diorama",
          result: "Typing",
        },
        {
          badge: "GENERATE",
          title: "Generate Image",
          body: "The image model generates a new image from your estimated prompt.",
          prompt:
            "red rocket, floating islands, waterfalls, tabletop toy diorama",
          result: "Generating",
        },
        {
          badge: "SCORE",
          title: "Scoring",
          body: "Compare the generated image with the target and score the match.",
          prompt:
            "red rocket, floating islands, waterfalls, tabletop toy diorama",
          result: "92 pts",
        },
      ],
    },
  },
  memory: {
    ja: {
      stageLabel: "記憶プレビュー",
      promptLabel: "プロンプト",
      outputLabel: "比較",
      steps: [
        {
          badge: "10 SEC",
          title: "お題画像を記憶",
          body: "短い観察時間で、画像の配置や細部を記憶する。",
          prompt:
            "城前の広場、青い噴水、黄色い風船、双塔、旗",
          result: "10 SEC",
        },
        {
          badge: "TYPE",
          title: "プロンプトを書く",
          body: "ここからは記憶だけでプロンプトを作る。",
          prompt:
            "城前の広場、青い噴水、黄色い風船、双塔、旗",
          result: "記憶中",
        },
        {
          badge: "GENERATE",
          title: "画像生成",
          body: "覚えて入力したプロンプトから、AIが再現画像を生成する。",
          prompt:
            "城前の広場、青い噴水、黄色い風船、双塔、旗",
          result: "生成中",
        },
        {
          badge: "MATCH",
          title: "スコアリング",
          body: "覚えていた要素が多いほど、生成画像が近づく。",
          prompt:
            "城前の広場、青い噴水、黄色い風船、双塔、旗",
          result: "81 pts",
        },
      ],
    },
    en: {
      stageLabel: "Memory Preview",
      promptLabel: "Prompt",
      outputLabel: "Compare",
      steps: [
        {
          badge: "10 SEC",
          title: "Memorize Target Image",
          body: "Use the short preview to remember the layout and visual details.",
          prompt:
            "castle plaza, blue fountain, yellow balloons, twin towers, flags",
          result: "10 SEC",
        },
        {
          badge: "TYPE",
          title: "Writing Prompt",
          body: "Write the prompt after the image is hidden.",
          prompt:
            "castle plaza, blue fountain, yellow balloons, twin towers, flags",
          result: "Hidden",
        },
        {
          badge: "GENERATE",
          title: "Generate Image",
          body: "The image model generates from the prompt you typed from memory.",
          prompt:
            "castle plaza, blue fountain, yellow balloons, twin towers, flags",
          result: "Generating",
        },
        {
          badge: "MATCH",
          title: "Scoring",
          body: "The closer your remembered details are, the better the score.",
          prompt:
            "castle plaza, blue fountain, yellow balloons, twin towers, flags",
          result: "81 pts",
        },
      ],
    },
  },
  change: {
    ja: {
      stageLabel: "変化画像",
      promptLabel: "観察メモ",
      outputLabel: "クリック",
      steps: [
        {
          badge: "BEFORE",
          title: "元画像を観察",
          body: "変化前の元画像を見て、自然な状態を覚える。",
          prompt: "バス停、ベンチ、赤いバッグ、右側の時刻表パネル",
          result: "待機",
        },
        {
          badge: "SHIFT",
          title: "画像がだんだん変化",
          body: "1か所だけがじわっと変わる様子を追う。",
          prompt: "右側の時刻表パネルが砂時計形に変化",
          result: "変化中",
        },
        {
          badge: "POINT",
          title: "変化した場所を指す",
          body: "見つけた変化の場所をマーカーで示す。",
          prompt: "砂時計形になった時刻表パネルを指す",
          result: "発見",
        },
      ],
    },
    en: {
      stageLabel: "Changing Image",
      promptLabel: "Focus Note",
      outputLabel: "Click",
      steps: [
        {
          badge: "BEFORE",
          title: "Observe Original Image",
          body: "Lock in the original scene before anything moves.",
          prompt: "bus stop, bench, red bag, right schedule panel",
          result: "Waiting",
        },
        {
          badge: "SHIFT",
          title: "Image Gradually Changes",
          body: "Watch one small object change while the scene stays still.",
          prompt: "right schedule panel changes into an hourglass shape",
          result: "Changing",
        },
        {
          badge: "POINT",
          title: "Point to Changed Spot",
          body: "Mark the place where the image changed.",
          prompt: "point to the hourglass-shaped schedule panel",
          result: "Found",
        },
      ],
    },
  },
  impostor: {
    ja: {
      stageLabel: "絵伝言",
      promptLabel: "伝言プロンプト",
      outputLabel: "投票",
      steps: [
        {
          badge: "ROLE",
          stepLabel: "STEP 1/5",
          title: "自分の役職が表示される",
          body: "CREWかIMPOSTERかを確認して、同じ画像リレーに参加する。",
          prompt: "YOU ARE CREW / YOU ARE IMPOSTER",
          result: "ROLE",
        },
        {
          badge: "CREW",
          stepLabel: "STEP 2/5",
          title: "CREWは似た画像を生成",
          body: "繋がれてきた画像とできるだけ似た画像を生成する。",
          prompt: "同じロボット画家と青い風景を保つ",
          result: "CREW",
        },
        {
          badge: "IMPOSTER",
          stepLabel: "STEP 2/5",
          title: "IMPOSTERは少し変える",
          body: "バレない程度に一部を変えた画像を生成する。",
          prompt: "青い風景を少し不穏な紫の森へずらす",
          result: "IMPOSTER",
        },
        {
          badge: "RELAY",
          stepLabel: "STEP 3/5",
          title: "プレイヤーが順番に画像をつなぐ",
          body: "IMPOSTER以降のCREWも、変化後の画像に引っ張られていく。",
          prompt: "Player 1 → Player 2 → Player 3 → Final",
          result: "RELAY",
        },
        {
          badge: "VOTE",
          stepLabel: "STEP 4/5",
          title: "IMPOSTERに投票",
          body: "リレー結果を見比べて、画像を変えたと思うプレイヤーに投票する。",
          prompt: "IMPOSTERだと思うプレイヤーに投票",
          result: "VOTE",
        },
        {
          badge: "CREW",
          stepLabel: "STEP 5/5",
          title: "CREWの勝利条件",
          body: "IMPOSTERを当てる、またはターゲット画像と最終画像の類似度が50pt以上ならCREW勝利。",
          prompt: "Find IMPOSTER or keep similarity 50pt+",
          result: "CREW WIN",
        },
        {
          badge: "IMP",
          stepLabel: "STEP 5/5",
          title: "IMPOSTERの勝利条件",
          body: "CREWに当てられず、ターゲット画像と最終画像の類似度を50pt未満にできればIMPOSTER勝利。",
          prompt: "Avoid votes and drop similarity below 50pt",
          result: "IMPOSTER WIN",
        },
      ],
    },
    en: {
      stageLabel: "Image Relay",
      promptLabel: "Relay Prompt",
      outputLabel: "Vote",
      steps: [
        {
          badge: "ROLE",
          stepLabel: "STEP 1/5",
          title: "Shown Your Role",
          body: "Check whether you are CREW or IMPOSTER before the relay starts.",
          prompt: "YOU ARE CREW / YOU ARE IMPOSTER",
          result: "ROLE",
        },
        {
          badge: "CREW",
          stepLabel: "STEP 2/5",
          title: "Crew Generates a Similar Image",
          body: "Generate an image as similar as possible to the one passed to you.",
          prompt: "keep the robot painter and blue landscape close",
          result: "CREW",
        },
        {
          badge: "IMPOSTER",
          stepLabel: "STEP 2/5",
          title: "Imposter Changes Part of It",
          body: "Change part of the image just enough to avoid being caught.",
          prompt: "nudge the blue landscape toward a strange purple forest",
          result: "IMPOSTER",
        },
        {
          badge: "RELAY",
          stepLabel: "STEP 3/5",
          title: "Players Pass Images Forward",
          body: "After the imposter acts, later players are pulled toward the changed image.",
          prompt: "Player 1 → Player 2 → Player 3 → Final",
          result: "RELAY",
        },
        {
          badge: "VOTE",
          stepLabel: "STEP 4/5",
          title: "Vote for the Imposter",
          body: "Compare the relay results and vote for the player who changed the image.",
          prompt: "Vote for the player you think is the imposter",
          result: "VOTE",
        },
        {
          badge: "CREW",
          stepLabel: "STEP 5/5",
          title: "Crew Win Condition",
          body: "Crew wins by finding the imposter, or by keeping final similarity to the target at 50pt or higher.",
          prompt: "Find IMPOSTER or keep similarity 50pt+",
          result: "CREW WIN",
        },
        {
          badge: "IMP",
          stepLabel: "STEP 5/5",
          title: "Imposter Win Condition",
          body: "Imposter wins by not being caught and pushing final similarity below 50pt.",
          prompt: "Avoid votes and drop similarity below 50pt",
          result: "IMPOSTER WIN",
        },
      ],
    },
  },
};

const ROUND_OPTIONS: readonly PickerOption[] = [
  { value: 1, label: "1", unitLabel: "ROUND" },
  { value: 2, label: "2", unitLabel: "ROUNDS" },
  { value: 3, label: "3", unitLabel: "ROUNDS" },
  { value: 4, label: "4", unitLabel: "ROUNDS" },
  { value: 5, label: "5", unitLabel: "ROUNDS" },
];

const STANDARD_ROUND_TIME_OPTIONS: readonly PickerOption[] =
  STANDARD_ROUND_SECONDS_OPTIONS.map((value) => ({
    value,
    label: String(value),
    unitLabel: "SEC",
  }));

const CHANGE_ROUND_TIME_OPTIONS: readonly PickerOption[] =
  CHANGE_ROUND_SECONDS_OPTIONS.map((value) => {
    const repeatCount = getChangeViewCountForRoundSeconds(value);
    return {
      value,
      label: String(repeatCount),
      unitLabel: repeatCount === 1 ? "VIEW" : "VIEWS",
    };
  });

function formatSettingsKey(
  gameMode: GameMode,
  totalRounds: number,
  roundSeconds: number,
  cpuCount: number,
) {
  return `${gameMode}:${totalRounds}:${roundSeconds}:${cpuCount}`;
}

function SwipeValuePicker({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  disabled = false,
}: SwipeValuePickerProps) {
  const { copy } = useLanguage();
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[currentIndex] ?? options[0];
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex < options.length - 1;

  const shiftIndex = (delta: number) => {
    if (disabled || delta === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(options.length - 1, currentIndex + delta),
    );
    if (nextIndex === currentIndex) return;
    onChange(options[nextIndex]!.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      shiftIndex(-1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      shiftIndex(1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(options[0]!.value);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(options[options.length - 1]!.value);
    }
  };

  return (
    <div className="grid min-h-0 grid-cols-[minmax(108px,0.2fr)_40px_minmax(0,1fr)_40px] items-stretch gap-2 py-1 sm:grid-cols-[minmax(120px,0.18fr)_42px_minmax(0,1fr)_42px]">
      <p className="flex min-w-0 items-center gap-2 text-[15px] leading-none font-black tracking-[0.08em] uppercase md:text-base">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[2px_2px_0_var(--pmb-ink)]">
          <Icon className="h-4 w-4 stroke-[3]" />
        </span>
        <span className="truncate">{label}</span>
      </p>

      <button
        type="button"
        disabled={disabled || !canDecrease}
        onClick={() => shiftIndex(-1)}
        aria-label={`${label} -`}
        className={[
          "grid h-full min-h-9 w-9 place-items-center rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white transition-transform duration-150 sm:w-10",
          "shadow-[3px_3px_0_var(--pmb-ink)] hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[2px_2px_0_var(--pmb-ink)]",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
      >
        <Minus className="h-5 w-5 stroke-[3]" />
      </button>

      <button
        type="button"
        disabled={disabled}
        onKeyDown={onKeyDown}
        className={[
          "relative flex h-full min-h-10 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-[14px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] text-center transition-transform duration-150",
          "shadow-[4px_4px_0_var(--pmb-ink)] hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--pmb-ink)]",
          "focus-visible:ring-4 focus-visible:ring-[color:color-mix(in_srgb,var(--pmb-blue)_55%,white)] focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
        aria-label={copy.lobby.changePickerAria(label)}
        aria-valuemin={options[0]!.value}
        aria-valuemax={options[options.length - 1]!.value}
        aria-valuenow={selectedOption.value}
        aria-valuetext={`${selectedOption.label} ${selectedOption.unitLabel}`}
        role="spinbutton"
      >
        <span className="text-[1.55rem] leading-none font-black tracking-[-0.02em] sm:text-[1.8rem]">
          {selectedOption.label}
        </span>
        {selectedOption.unitLabel ? (
          <span className="text-[11px] font-black tracking-[0.2em] uppercase">
            {selectedOption.unitLabel}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        disabled={disabled || !canIncrease}
        onClick={() => shiftIndex(1)}
        aria-label={`${label} +`}
        className={[
          "grid h-full min-h-9 w-9 place-items-center rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white transition-transform duration-150 sm:w-10",
          "shadow-[3px_3px_0_var(--pmb-ink)] hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[2px_2px_0_var(--pmb-ink)]",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-[2px_2px_0_var(--pmb-ink)]",
        ].join(" ")}
      >
        <Plus className="h-5 w-5 stroke-[3]" />
      </button>
    </div>
  );
}

function TypedPromptLine({
  text,
  isTyping,
}: {
  text: string;
  isTyping: boolean;
}) {
  const [typingState, setTypingState] = useState({
    text: "",
    visibleText: "",
  });

  useEffect(() => {
    if (!isTyping) {
      return;
    }

    const durationMs = 1450;
    let animationFrame = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const nextLength = Math.ceil(text.length * progress);
      setTypingState({
        text,
        visibleText: text.slice(0, nextLength),
      });

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isTyping, text]);

  const visibleText = isTyping
    ? typingState.text === text
      ? typingState.visibleText
      : ""
    : text;

  return (
    <span className="relative inline-flex max-w-full items-center">
      <span className="block truncate">{visibleText}</span>
      {isTyping ? (
        <motion.span
          aria-hidden="true"
          className="ml-0.5 h-4 w-1 rounded-full bg-[var(--pmb-ink)]"
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.72, repeat: Infinity }}
        />
      ) : null}
    </span>
  );
}

function ImpostorImageCard({
  src,
  label,
  badge,
  highlight = false,
  delay = 0,
}: {
  src: string;
  label: string;
  badge?: string;
  highlight?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ y: 10, opacity: 0, rotate: highlight ? -1.5 : 0.8 }}
      animate={{ y: 0, opacity: 1, rotate: highlight ? -1 : 0 }}
      transition={{ delay, duration: 0.24 }}
      className={[
        "relative h-full min-h-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[3px_3px_0_var(--pmb-ink)]",
        highlight ? "bg-[var(--pmb-yellow)]" : "",
      ].join(" ")}
    >
      <Image
        src={src}
        alt=""
        fill
        priority
        unoptimized
        sizes="(min-width: 1280px) 14vw, (min-width: 640px) 30vw, 90vw"
        className="object-cover"
      />
      <div className="absolute inset-x-1.5 top-1.5 z-10 flex items-center justify-between gap-1">
        <span className="truncate rounded-full border-2 border-[var(--pmb-ink)] bg-white px-2 py-0.5 text-[9px] font-black shadow-[1px_1px_0_var(--pmb-ink)]">
          {label}
        </span>
        {badge ? (
          <span
            className={[
              "rounded-full border-2 border-[var(--pmb-ink)] px-2 py-0.5 text-[9px] font-black shadow-[1px_1px_0_var(--pmb-ink)]",
              highlight ? "bg-[var(--pmb-red)] text-white" : "bg-white",
            ].join(" ")}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

function ImpostorRoleStage({ language }: { language: Language }) {
  const roleCards = [
    {
      role: "CREW",
      icon: Users,
      body:
        language === "ja"
          ? "受け取った画像に寄せる。"
          : "Match the passed image.",
      className: "bg-[var(--pmb-green)]",
      roleTextClassName: "text-[clamp(1.35rem,4.5dvh,4.2rem)]",
    },
    {
      role: "IMPOSTER",
      icon: Ghost,
      body:
        language === "ja"
          ? "バレずに少し変える。"
          : "Shift it without getting caught.",
      className: "bg-[var(--pmb-red)] text-white",
      roleTextClassName: "text-[clamp(1.25rem,4dvh,3.35rem)]",
    },
  ];

  return (
    <div className="grid h-full min-h-0 overflow-hidden gap-2 md:grid-cols-2">
      {roleCards.map((card, index) => {
        const Icon = card.icon;

        return (
          <motion.div
            key={card.role}
            initial={{
              rotate: index === 0 ? -1.5 : 1.5,
              scale: 0.94,
              opacity: 0,
            }}
            animate={{
              rotate: index === 0 ? -0.5 : 0.5,
              scale: 1,
              opacity: 1,
            }}
            transition={{ delay: index * 0.08, duration: 0.28 }}
            className={[
              "grid h-full min-h-0 min-w-0 place-items-center overflow-hidden rounded-[16px] border-4 border-[var(--pmb-ink)] p-3 text-center shadow-[4px_4px_0_var(--pmb-ink)] md:p-4",
              card.className,
            ].join(" ")}
          >
            <div className="grid min-h-0 min-w-0 max-w-full gap-1 px-1 md:gap-2">
              <Icon className="mx-auto h-5 w-5 md:h-8 md:w-8" />
              <p className="text-[clamp(1.2rem,3.8dvh,3.6rem)] leading-none font-black">
                YOU ARE
              </p>
              <p
                className={[
                  "max-w-full overflow-hidden leading-none font-black whitespace-nowrap",
                  card.roleTextClassName,
                ].join(" ")}
              >
                {card.role}
              </p>
              <p className="mx-auto max-w-[20ch] overflow-hidden text-[clamp(0.68rem,1.35dvh,1rem)] leading-tight font-black">
                {card.body}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function ImpostorGenerationStage({
  language,
  variant,
}: {
  language: Language;
  variant: "crew" | "imposter";
}) {
  const isCrew = variant === "crew";
  const incomingImage = isCrew
    ? IMPOSTOR_RELAY_IMAGES[0]
    : IMPOSTOR_RELAY_IMAGES[1];
  const outputImage = isCrew
    ? IMPOSTOR_RELAY_IMAGES[1]
    : IMPOSTOR_RELAY_IMAGES[2];

  return (
    <div className="relative grid h-full min-h-0 overflow-hidden gap-2 md:grid-cols-2">
      <ImpostorImageCard
        src={incomingImage}
        label={language === "ja" ? "受け取った画像" : "Incoming Image"}
      />

      <motion.div
        aria-hidden="true"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.2 }}
        className="absolute top-1/2 left-1/2 z-20 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[var(--pmb-ink)] bg-white text-base font-black shadow-[2px_2px_0_var(--pmb-ink)] md:grid"
      >
        →
      </motion.div>

      <ImpostorImageCard
        src={outputImage}
        label={language === "ja" ? "生成画像" : "Generated Image"}
        badge={isCrew ? "CREW" : "IMPOSTER"}
        highlight={!isCrew}
      />
    </div>
  );
}

function ImpostorRelayStage({ language }: { language: Language }) {
  const relayCards = [
    {
      label: language === "ja" ? "Target" : "Target",
      src: IMPOSTOR_RELAY_IMAGES[0],
      highlight: false,
    },
    {
      label: "Player 1",
      badge: "CREW",
      src: IMPOSTOR_RELAY_IMAGES[1],
      highlight: false,
    },
    {
      label: "Player 2",
      badge: "IMPOSTER",
      src: IMPOSTOR_RELAY_IMAGES[2],
      highlight: true,
    },
    {
      label: "Player 3",
      badge: "CREW",
      src: IMPOSTOR_RELAY_IMAGES[3],
      highlight: false,
    },
  ];

  return (
    <div className="grid h-full min-h-0 grid-cols-2 overflow-hidden gap-2 md:grid-cols-4">
      {relayCards.map((card, index) => (
        <div key={card.label} className="relative h-full min-h-0 min-w-0">
          <ImpostorImageCard
            src={card.src}
            label={card.label}
            badge={card.badge}
            highlight={card.highlight}
            delay={index * 0.12}
          />
          {index < relayCards.length - 1 ? (
            <motion.div
              aria-hidden="true"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: index * 0.12 + 0.1, duration: 0.2 }}
              className="absolute top-1/2 right-[-13px] z-20 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full border-2 border-[var(--pmb-ink)] bg-white text-sm font-black shadow-[2px_2px_0_var(--pmb-ink)] md:grid"
            >
              →
            </motion.div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ImpostorVoteStage({ language }: { language: Language }) {
  const voteCards = [
    {
      player: "Player 1",
      voterMarks: [] as string[],
      src: IMPOSTOR_RELAY_IMAGES[1],
      suspect: false,
    },
    {
      player: "Player 2",
      voterMarks: ["1", "3"],
      src: IMPOSTOR_RELAY_IMAGES[2],
      suspect: true,
    },
    {
      player: "Player 3",
      voterMarks: ["2"],
      src: IMPOSTOR_RELAY_IMAGES[3],
      suspect: false,
    },
  ];
  const voteRows = [
    { voter: "Player 1", target: "Player 2" },
    { voter: "Player 2", target: "Player 3" },
    { voter: "Player 3", target: "Player 2" },
  ];

  return (
    <div className="grid h-full min-h-0 overflow-hidden gap-2 md:grid-cols-[minmax(0,1fr)_minmax(150px,0.24fr)]">
      <div className="grid h-full min-h-0 grid-cols-3 gap-2">
        {voteCards.map((card, index) => (
          <motion.div
            key={card.player}
            initial={{ y: 10, rotate: index % 2 === 0 ? -1.5 : 1.5 }}
            animate={{ y: 0, rotate: card.suspect ? -2 : 0 }}
            transition={{ delay: index * 0.05, duration: 0.22 }}
            className={[
              "relative min-h-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[3px_3px_0_var(--pmb-ink)]",
              card.suspect ? "bg-[var(--pmb-yellow)]" : "",
            ].join(" ")}
          >
            <Image
              src={card.src}
              alt=""
              fill
              priority
              unoptimized
              sizes="(min-width: 1280px) 12vw, (min-width: 640px) 22vw, 30vw"
              className="object-cover"
            />
            <div className="absolute inset-x-1.5 top-1.5 z-10 flex items-center gap-1">
              <span className="truncate rounded-full border-2 border-[var(--pmb-ink)] bg-white px-2 py-0.5 text-[9px] font-black shadow-[1px_1px_0_var(--pmb-ink)]">
                {card.player}
              </span>
            </div>
            <div className="absolute right-2 bottom-2 z-10 flex flex-wrap justify-end gap-1">
              {card.voterMarks.map((voterMark, voteIndex) => (
                <motion.span
                  key={voterMark}
                  initial={{ scale: 0, y: 8, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  transition={{
                    delay: card.suspect ? voteIndex * 0.28 + 0.18 : 0.18,
                    duration: 0.2,
                  }}
                  className="grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] font-mono text-[10px] font-black shadow-[1px_1px_0_var(--pmb-ink)]"
                >
                  {voterMark}
                </motion.span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white p-2 shadow-[3px_3px_0_var(--pmb-ink)]">
        <div className="flex items-center gap-1.5">
          <Vote className="h-4 w-4" />
          <p className="truncate text-sm font-black">
            {language === "ja" ? "投票先" : "Votes"}
          </p>
        </div>
        <div className="min-h-0 space-y-1.5 overflow-hidden">
          {voteRows.map((voteRow, index) => (
            <motion.div
              key={voteRow.voter}
              initial={{ x: 8, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: index * 0.08, duration: 0.2 }}
              className={[
                "flex items-center justify-between gap-2 rounded-[9px] border-2 border-[var(--pmb-ink)] px-2 py-1 text-[10px] font-black",
                index === 0
                  ? "bg-[var(--pmb-yellow)] shadow-[1px_1px_0_var(--pmb-ink)]"
                  : "bg-[var(--pmb-base)]",
              ].join(" ")}
            >
              <span className="truncate">{voteRow.voter}</span>
              <span className="truncate">{voteRow.target}</span>
            </motion.div>
          ))}
        </div>
        <div className="rounded-[10px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-red)] px-2 py-1.5 text-center font-mono text-[12px] font-black text-white shadow-[2px_2px_0_var(--pmb-ink)]">
          PLAYER 2: 2 / 3
        </div>
      </div>
    </div>
  );
}

function ImpostorWinStage({
  language,
  winner,
}: {
  language: Language;
  winner: "crew" | "imposter";
}) {
  const isCrew = winner === "crew";
  const conditions = isCrew
    ? [
        language === "ja"
          ? "IMPOSTERを当てる"
          : "Find the imposter",
        language === "ja"
          ? "またはターゲット画像と最終画像の類似度が50pt以上"
          : "or keep final similarity to the target at 50pt or higher",
      ]
    : [
        language === "ja"
          ? "CREWに当てられない"
          : "Do not get caught by crew",
        language === "ja"
          ? "かつターゲット画像と最終画像の類似度を50pt未満にする"
          : "and push final similarity below 50pt",
      ];

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.48fr)_minmax(0,0.52fr)] overflow-hidden gap-2 md:grid-cols-[minmax(0,0.52fr)_minmax(0,0.48fr)] md:grid-rows-1">
      <div className="grid h-full min-h-0 grid-cols-2 gap-2 md:grid-cols-1 md:grid-rows-2">
        {[
          {
            label: language === "ja" ? "最初の画像" : "Target Image",
            src: IMPOSTOR_RELAY_IMAGES[0],
          },
          {
            label: language === "ja" ? "最後の画像" : "Final Image",
            src: IMPOSTOR_RELAY_IMAGES[3],
          },
        ].map((image, index) => (
          <motion.div
            key={image.label}
            initial={{ x: -12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: index * 0.08, duration: 0.22 }}
            className="relative h-full min-h-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[3px_3px_0_var(--pmb-ink)]"
          >
            <Image
              src={image.src}
              alt=""
              fill
              priority
              unoptimized
              sizes="(min-width: 1280px) 18vw, (min-width: 640px) 36vw, 90vw"
              className="object-cover"
            />
            <span className="absolute top-1.5 left-1.5 z-10 rounded-full border-2 border-[var(--pmb-ink)] bg-white px-2 py-0.5 text-[9px] font-black shadow-[1px_1px_0_var(--pmb-ink)]">
              {image.label}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.92fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
        <div
          className={[
            "flex min-h-0 items-center justify-center gap-2 overflow-hidden rounded-[14px] border-4 border-[var(--pmb-ink)] p-2 text-center shadow-[3px_3px_0_var(--pmb-ink)] md:p-3",
            isCrew
              ? "bg-[var(--pmb-green)]"
              : "bg-[var(--pmb-red)] text-white",
          ].join(" ")}
        >
          <div className="shrink-0">
            {isCrew ? (
              <Trophy className="h-5 w-5 md:h-7 md:w-7" />
            ) : (
              <Ghost className="h-5 w-5 md:h-7 md:w-7" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[9px] leading-none font-black tracking-[0.14em] uppercase md:text-[10px]">
              {language === "ja" ? "勝利条件" : "Win Condition"}
            </p>
            <p className="truncate text-[clamp(0.95rem,2.2dvh,2.2rem)] leading-none font-black">
              {isCrew ? "CREW" : "IMPOSTER"} WINS
            </p>
          </div>
        </div>

        {conditions.map((condition, index) => (
          <motion.div
            key={condition}
            initial={{ x: 12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: index * 0.1, duration: 0.22 }}
            className="grid min-h-0 grid-cols-[auto_1fr] items-center gap-1.5 overflow-hidden rounded-[14px] border-4 border-[var(--pmb-ink)] bg-white p-1.5 shadow-[3px_3px_0_var(--pmb-ink)] md:gap-2 md:p-2"
          >
            <span
              className={[
                "grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--pmb-ink)] md:h-6 md:w-6",
                isCrew ? "bg-[var(--pmb-green)]" : "bg-[var(--pmb-red)] text-white",
              ].join(" ")}
            >
              <Check className="h-3 w-3 md:h-4 md:w-4" />
            </span>
            <p className="min-w-0 truncate text-[10px] leading-none font-black md:text-[11px]">
              {condition}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ImpostorDemoStage({
  stepIndex,
  language,
}: {
  stepIndex: number;
  language: Language;
}) {
  if (stepIndex === 0) {
    return <ImpostorRoleStage language={language} />;
  }

  if (stepIndex === 1) {
    return <ImpostorGenerationStage language={language} variant="crew" />;
  }

  if (stepIndex === 2) {
    return <ImpostorGenerationStage language={language} variant="imposter" />;
  }

  if (stepIndex === 3) {
    return <ImpostorRelayStage language={language} />;
  }

  if (stepIndex === 4) {
    return <ImpostorVoteStage language={language} />;
  }

  return (
    <ImpostorWinStage
      language={language}
      winner={stepIndex === 5 ? "crew" : "imposter"}
    />
  );
}

function ModeGameplayPreview({
  mode,
  language,
}: {
  mode: GameMode;
  language: Language;
}) {
  const demo = MODE_GAMEPLAY_DEMOS[mode][language];
  const demoStepCount = demo.steps.length;
  const [stepIndex, setStepIndex] = useState(0);
  const [stepControlsVisible, setStepControlsVisible] = useState(false);
  const step = demo.steps[stepIndex] ?? demo.steps[0];
  const isPromptCompareMode = mode === "classic" || mode === "memory";
  const previewTargetImage =
    mode === "change"
      ? MODE_DEMO_IMAGES.changeBefore
      : MODE_PREVIEW_IMAGES[mode].target;
  const previewGeneratedImage =
    mode === "change"
      ? MODE_DEMO_IMAGES.changeAfter
      : MODE_PREVIEW_IMAGES[mode].generated;
  const changeAfterOpacity = mode === "change" ? (stepIndex === 0 ? 0 : 1) : 0;
  const changeAfterTransitionDuration =
    mode === "change" && stepIndex === 1
      ? MODE_DEMO_STEP_INTERVAL_MS / 1000
      : 0.18;
  const promptIsTyping = isPromptCompareMode && stepIndex === 1;
  const targetLabel = language === "ja" ? "お題画像" : "Target Image";
  const generatedLabel =
    mode === "impostor"
        ? language === "ja"
          ? "リレー画像"
          : "Relay Image"
        : language === "ja"
          ? "生成画像"
          : "Generated Image";
  const rankingLabel = language === "ja" ? "ランキング" : "Ranking";
  const scoreValue =
    mode === "memory"
      ? "81 pts"
      : mode === "change"
        ? "HIT +120"
        : "92 pts";
  const secondaryScoreValue =
    mode === "memory"
      ? "67 pts"
      : mode === "change"
        ? "MISS 0"
        : "74 pts";
  const shouldHideTarget = mode === "memory" && stepIndex === 1;
  const shouldRenderGeneratedImage =
    !isPromptCompareMode || stepIndex >= 2;
  const generatedImageOpacity = isPromptCompareMode
    ? stepIndex >= 2
      ? 1
      : 0
    : mode === "change"
      ? 1
      : stepIndex === 0
        ? 0.35
        : stepIndex === 1
          ? 0.72
          : 1;
  const showScore = isPromptCompareMode
    ? stepIndex === 3
    : mode !== "impostor" && stepIndex === 2;
  const showGeneratedPulse = isPromptCompareMode
    ? stepIndex === 2
    : mode !== "change" && stepIndex === 1;
  const showRankingScores = isPromptCompareMode
    ? stepIndex === 3
    : stepIndex === 2;
  const showSidePanel = mode !== "impostor";
  const showPromptPanel = mode !== "change" && mode !== "impostor";
  const promptText = isPromptCompareMode && stepIndex === 0 ? "" : step.prompt;
  const impostorRoleBadge =
    mode === "impostor"
      ? stepIndex === 1 || stepIndex === 5
        ? "CREW"
        : stepIndex === 2 || stepIndex === 6
          ? "IMPOSTER"
          : null
      : null;
  const moveDemoStep = (delta: -1 | 1) => {
    setStepIndex(
      (current) => (current + delta + demoStepCount) % demoStepCount,
    );
  };

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStepIndex((current) => (current + 1) % demoStepCount);
    }, MODE_DEMO_STEP_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [demoStepCount, stepIndex]);

  return (
    <motion.div
      key={mode}
      initial={{ opacity: 0, x: 18, rotate: 0.4, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }}
      exit={{ opacity: 0, x: -14, rotate: -0.4, scale: 0.98 }}
      transition={{ type: "spring", bounce: 0.24, duration: 0.36 }}
      onMouseEnter={() => setStepControlsVisible(true)}
      onMouseLeave={() => setStepControlsVisible(false)}
      onFocusCapture={() => setStepControlsVisible(true)}
      onBlurCapture={(event) => {
        const nextFocusedNode = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextFocusedNode)) {
          setStepControlsVisible(false);
        }
      }}
      className="relative isolate aspect-[47/20] h-full min-h-0 max-w-full overflow-hidden rounded-[18px] border-4 border-[var(--pmb-ink)] bg-[linear-gradient(135deg,#fff_0%,var(--pmb-base)_100%)] p-2 shadow-[5px_5px_0_var(--pmb-ink)]"
    >
      <div className="absolute inset-x-0 top-0 h-3 border-b-4 border-[var(--pmb-ink)] bg-[repeating-linear-gradient(90deg,var(--pmb-yellow)_0_18px,var(--pmb-blue)_18px_36px,var(--pmb-green)_36px_54px,var(--pmb-red)_54px_72px)]" />
      <motion.div
        className="absolute top-7 right-5 h-7 w-7 rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)]"
        animate={{ y: [0, -7, 0], rotate: [0, 10, 0] }}
        transition={{
          duration: 2.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <button
        type="button"
        aria-label={
          language === "ja" ? "前の説明ステップ" : "Previous demo step"
        }
        onClick={(event) => {
          event.stopPropagation();
          moveDemoStep(-1);
        }}
        className={[
          "absolute top-1/2 left-2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border-4 border-[var(--pmb-ink)] bg-white/95 shadow-[3px_3px_0_var(--pmb-ink)] transition-all duration-150",
          stepControlsVisible
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
          "hover:scale-105",
          "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-4 focus-visible:ring-[color:color-mix(in_srgb,var(--pmb-blue)_55%,white)] focus-visible:outline-none",
        ].join(" ")}
      >
        <ChevronLeft className="h-6 w-6 stroke-[4]" />
      </button>
      <button
        type="button"
        aria-label={
          language === "ja" ? "次の説明ステップ" : "Next demo step"
        }
        onClick={(event) => {
          event.stopPropagation();
          moveDemoStep(1);
        }}
        className={[
          "absolute top-1/2 right-2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border-4 border-[var(--pmb-ink)] bg-white/95 shadow-[3px_3px_0_var(--pmb-ink)] transition-all duration-150",
          stepControlsVisible
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
          "hover:scale-105",
          "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-4 focus-visible:ring-[color:color-mix(in_srgb,var(--pmb-blue)_55%,white)] focus-visible:outline-none",
        ].join(" ")}
      >
        <ChevronRight className="h-6 w-6 stroke-[4]" />
      </button>

      <div
        className={[
          "relative z-10 grid h-full min-h-0 gap-2 pt-3",
          showSidePanel
            ? "md:grid-cols-[minmax(0,1fr)_minmax(116px,0.3fr)]"
            : "md:grid-cols-1",
        ].join(" ")}
      >
        <div
          className={[
            "grid min-h-0 gap-2",
            showPromptPanel
              ? "grid-rows-[auto_minmax(0,1fr)_minmax(3.25rem,0.3fr)]"
              : "grid-rows-[auto_minmax(0,1fr)]",
          ].join(" ")}
        >
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white px-3 py-1.5 shadow-[3px_3px_0_var(--pmb-ink)]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-0.5 text-[10px] font-black tracking-[0.08em] uppercase">
                {step.stepLabel ?? `STEP ${stepIndex + 1}/${demoStepCount}`}
              </span>
              {impostorRoleBadge ? (
                <span
                  className={[
                    "rounded-full border-2 border-[var(--pmb-ink)] px-2 py-0.5 text-[10px] font-black tracking-[0.08em] uppercase shadow-[1px_1px_0_var(--pmb-ink)]",
                    impostorRoleBadge === "CREW"
                      ? "bg-[var(--pmb-green)]"
                      : "bg-[var(--pmb-red)] text-white",
                  ].join(" ")}
                >
                  {impostorRoleBadge}
                </span>
              ) : null}
              <AnimatePresence mode="wait">
                <motion.p
                  key={`${mode}-${stepIndex}-title`}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="truncate text-sm font-black"
                  data-testid="mode-demo-step-title"
                >
                  {step.title}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {mode === "impostor" ? (
            <ImpostorDemoStage stepIndex={stepIndex} language={language} />
          ) : mode === "change" ? (
            <div className="relative min-h-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[3px_3px_0_var(--pmb-ink)]">
              <motion.div
                className="absolute inset-0"
                animate={{ opacity: 1 }}
                transition={{ duration: 0.28 }}
              >
                <Image
                  src={MODE_DEMO_IMAGES.changeBefore}
                  alt=""
                  fill
                  priority
                  unoptimized
                  sizes="(min-width: 1280px) 38vw, (min-width: 640px) 72vw, 90vw"
                  className="object-cover"
                />
              </motion.div>
              <motion.div
                className="absolute inset-0"
                animate={{ opacity: changeAfterOpacity }}
                transition={{
                  duration: changeAfterTransitionDuration,
                  ease: stepIndex === 1 ? "linear" : "easeOut",
                }}
              >
                <Image
                  src={MODE_DEMO_IMAGES.changeAfter}
                  alt=""
                  fill
                  priority
                  unoptimized
                  sizes="(min-width: 1280px) 38vw, (min-width: 640px) 72vw, 90vw"
                  className="object-cover"
                />
              </motion.div>
              {stepIndex === 2 ? (
                <motion.span
                  data-testid="mode-demo-click-marker"
                  initial={{ scale: 0.2, opacity: 0 }}
                  animate={{ scale: [0.2, 1.18, 1], opacity: 1 }}
                  transition={{ duration: 0.36 }}
                  className="absolute top-[45%] left-[74%] z-30 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[var(--pmb-green)] bg-[var(--pmb-green)] shadow-[0_0_0_2px_white]"
                />
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-0 gap-2 sm:grid-cols-2">
              <div className="relative min-h-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[3px_3px_0_var(--pmb-ink)]">
                <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 rounded-full border-2 border-[var(--pmb-ink)] bg-white px-2 py-0.5 text-[9px] font-black tracking-[0.08em] uppercase shadow-[2px_2px_0_var(--pmb-ink)]">
                  <ImageIcon className="h-3 w-3" />
                  {targetLabel}
                </div>
                <Image
                  src={previewTargetImage}
                  alt=""
                  fill
                  priority
                  unoptimized
                  sizes="(min-width: 1280px) 18vw, (min-width: 640px) 36vw, 90vw"
                  className="object-cover"
                />
                {shouldHideTarget ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-10 grid place-items-center bg-[linear-gradient(135deg,var(--pmb-base),white)]"
                  >
                    <div className="grid place-items-center gap-1 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[3px_3px_0_var(--pmb-ink)]">
                        <EyeOff className="h-6 w-6" />
                      </div>
                      <p className="text-[11px] font-black uppercase">
                        {step.result}
                      </p>
                    </div>
                  </motion.div>
                ) : null}
              </div>

              <div className="relative min-h-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white shadow-[3px_3px_0_var(--pmb-ink)]">
                <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 rounded-full border-2 border-[var(--pmb-ink)] bg-white px-2 py-0.5 text-[9px] font-black tracking-[0.08em] uppercase shadow-[2px_2px_0_var(--pmb-ink)]">
                  <Play className="h-3 w-3 fill-[var(--pmb-ink)]" />
                  {generatedLabel}
                </div>
                {shouldRenderGeneratedImage ? (
                  <motion.div
                    className="absolute inset-0"
                    initial={{ opacity: generatedImageOpacity }}
                    animate={{ opacity: generatedImageOpacity }}
                    transition={{ duration: 0.28 }}
                  >
                    <Image
                      src={previewGeneratedImage}
                      alt=""
                      fill
                      priority
                      unoptimized
                      sizes="(min-width: 1280px) 18vw, (min-width: 640px) 36vw, 90vw"
                      className="object-cover"
                    />
                  </motion.div>
                ) : null}
                {showGeneratedPulse ? (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-black/30">
                    <span className="flex items-center gap-2 rounded-[10px] border-2 border-[var(--pmb-ink)] bg-white px-3 py-2 text-[11px] font-black shadow-[2px_2px_0_var(--pmb-ink)]">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      {step.result}
                    </span>
                  </div>
                ) : null}
                {showScore ? (
                  <motion.p
                    initial={{ scale: 0.7, rotate: -4 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="absolute top-2 right-2 z-20 rounded-[10px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-1 font-mono text-sm font-black shadow-[2px_2px_0_var(--pmb-ink)]"
                  >
                    {scoreValue}
                  </motion.p>
                ) : null}
              </div>
            </div>
          )}

          {showPromptPanel ? (
            <div className="grid min-h-0 rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white p-2 shadow-[3px_3px_0_var(--pmb-ink)]">
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1 text-[9px] font-black tracking-[0.12em] uppercase">
                  <Send className="h-3 w-3" />
                  {demo.promptLabel}
                </p>
                <div className="min-h-0 px-1 py-1.5 font-mono text-[11px] font-black">
                  <TypedPromptLine
                    text={promptText}
                    isTyping={promptIsTyping}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {showSidePanel ? (
          <div className="grid min-h-0 grid-rows-[auto_1fr] gap-2 rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white p-2 shadow-[3px_3px_0_var(--pmb-ink)]">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-4 w-4" />
              <p className="truncate text-sm font-black">{rankingLabel}</p>
            </div>
            <div className="space-y-1.5">
              <motion.div
                key={`${mode}-${showRankingScores ? "scored" : "pending"}-rank-main`}
                initial={{ x: 10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.22 }}
                className="rounded-[10px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-1.5 shadow-[2px_2px_0_var(--pmb-ink)]"
              >
                <p className="truncate text-[11px] font-black">
                  Player 1
                </p>
                <p className="font-mono text-base leading-none font-black">
                  {showRankingScores ? scoreValue : "--"}
                </p>
              </motion.div>
              <div className="rounded-[10px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-2 py-1.5">
                <p className="truncate text-[11px] font-black">
                  Player 2
                </p>
                <p className="font-mono text-sm leading-none font-black">
                  {showRankingScores ? secondaryScoreValue : "--"}
                </p>
              </div>
              <div className="hidden rounded-[10px] border-2 border-[var(--pmb-ink)] bg-white px-2 py-1.5 xl:block">
                <p className="truncate text-[11px] font-black">
                  Player 3
                </p>
                <p className="font-mono text-sm leading-none font-black">
                  {showRankingScores ? "61 pts" : "--"}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

export default function LobbyPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { language, copy } = useLanguage();
  const { user, loading, error: authError } = useAuth();
  const [isLeaving, setIsLeaving] = useState(false);
  const {
    snapshot,
    error: snapshotError,
    isConnecting,
  } = useRoomSync({
    roomId,
    view: "lobby",
    enabled: Boolean(user) && !loading && !isLeaving,
  });

  const [actionBusy, setActionBusy] = useState<ActionBusy>(null);
  const [actionError, setActionError] = useState<UiError | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>("idle");
  const [settingsError, setSettingsError] = useState<UiError | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "error">(
    "idle",
  );
  const [draftGameMode, setDraftGameMode] = useState<GameMode>("classic");
  const [draftTotalRounds, setDraftTotalRounds] = useState(1);
  const [draftRoundSeconds, setDraftRoundSeconds] = useState(60);
  const [draftCpuCount, setDraftCpuCount] = useState(0);
  const [draftsReady, setDraftsReady] = useState(false);
  const [optimisticReady, setOptimisticReady] = useState<boolean | null>(null);
  const saveSequenceRef = useRef(0);
  const autoReadyAttemptedRef = useRef(false);

  const room = snapshot.room;
  const players = snapshot.players;
  const displayPlayers = players.map((player) =>
    player.uid === user?.uid && optimisticReady !== null
      ? { ...player, ready: optimisticReady }
      : player,
  );
  const me = displayPlayers.find((player) => player.uid === user?.uid) ?? null;
  const currentGameMode = room?.settings?.gameMode ?? "classic";
  const currentTotalRounds = room?.settings?.totalRounds ?? 1;
  const currentRoundSeconds = room?.settings?.roundSeconds ?? 60;
  const currentCpuCount = room?.settings?.cpuCount ?? 0;
  const displayGameMode =
    me?.isHost && draftsReady ? draftGameMode : currentGameMode;
  const nextRoundPreparation = room?.nextRoundPreparation ?? null;
  const currentMode = getGameModeDefinition(displayGameMode, language);
  const gameModeOptions = getGameModeOptions(language);
  const roundTimeOptions =
    draftGameMode === "change"
      ? CHANGE_ROUND_TIME_OPTIONS
      : STANDARD_ROUND_TIME_OPTIONS;
  const readyCount = displayPlayers.filter((player) => player.ready).length;
  const everyoneReady =
    displayPlayers.length > 0 && readyCount === displayPlayers.length;
  const humanPlayerCount = displayPlayers.filter(
    (player) => player.kind === "human",
  ).length;
  const maxPlayers = room?.settings?.maxPlayers ?? 8;
  const maxCpuCount = Math.max(
    0,
    Math.min(
      getMaxCpuPlayersForMode(draftGameMode),
      maxPlayers - humanPlayerCount,
    ),
  );
  const cpuOptions = Array.from({ length: maxCpuCount + 1 }, (_, index) => ({
    value: index,
    label: String(index),
    unitLabel: "CPU",
  }));
  const roomStatus = room?.status ?? null;
  const isGenerating = roomStatus === "GENERATING_ROUND";
  const hostCanEdit =
    Boolean(me?.isHost) && roomStatus === "LOBBY" && !isGenerating;
  const currentSettingsKey = formatSettingsKey(
    currentGameMode,
    currentTotalRounds,
    currentRoundSeconds,
    currentCpuCount,
  );
  const draftSettingsKey = formatSettingsKey(
    draftGameMode,
    draftTotalRounds,
    draftRoundSeconds,
    draftGameMode === "change" ? 0 : draftCpuCount,
  );
  const settingsDirty = currentSettingsKey !== draftSettingsKey;
  const settingsPending = settingsDirty || settingsStatus === "saving";
  const canStartRound =
    (displayGameMode === "change"
      ? humanPlayerCount >= 1
      : displayPlayers.length >= (displayGameMode === "impostor" ? 2 : 1)) &&
    Boolean(me?.isHost) &&
    everyoneReady &&
    !isGenerating &&
    actionBusy === null &&
    !settingsPending;
  const canShufflePlayers =
    Boolean(me?.isHost) &&
    roomStatus === "LOBBY" &&
    !isGenerating &&
    actionBusy === null &&
    displayPlayers.length >= 2;

  useEffect(() => {
    if (!roomStatus) return;

    if (roomStatus === "IN_ROUND") {
      router.replace(buildCurrentAppPath(`/round/${roomId}`));
      return;
    }

    if (roomStatus === "RESULTS") {
      router.replace(buildCurrentAppPath(`/results/${roomId}`));
      return;
    }

    if (roomStatus === "FINISHED") {
      router.replace(buildCurrentAppPath("/"));
    }
  }, [roomId, roomStatus, router]);

  useEffect(() => {
    if (optimisticReady === null) return;
    const actualReady =
      players.find((player) => player.uid === user?.uid)?.ready ?? null;
    if (actualReady === optimisticReady) {
      setOptimisticReady(null);
    }
  }, [optimisticReady, players, user?.uid]);

  useEffect(() => {
    if (!roomStatus) return;
    if (!draftsReady) {
      setDraftGameMode(currentGameMode);
      setDraftTotalRounds(currentTotalRounds);
      setDraftRoundSeconds(currentRoundSeconds);
      setDraftCpuCount(currentCpuCount);
      setDraftsReady(true);
      return;
    }

    if (me?.isHost && settingsDirty) {
      return;
    }

    setDraftGameMode(currentGameMode);
    setDraftTotalRounds(currentTotalRounds);
    setDraftRoundSeconds(currentRoundSeconds);
    setDraftCpuCount(currentCpuCount);
  }, [
    currentCpuCount,
    currentGameMode,
    currentRoundSeconds,
    currentTotalRounds,
    draftsReady,
    me?.isHost,
    roomStatus,
    settingsDirty,
  ]);

  useEffect(() => {
    if (!draftsReady || !hostCanEdit || !roomStatus || !settingsDirty) return;

    setSettingsStatus("saving");
    setSettingsError(null);
    const sequence = ++saveSequenceRef.current;
    const timerId = window.setTimeout(() => {
      void apiPost("/api/rooms/settings", {
        roomId,
        settings: {
          gameMode: draftGameMode,
          totalRounds: draftTotalRounds,
          roundSeconds: draftRoundSeconds,
          cpuCount: draftGameMode === "change" ? 0 : draftCpuCount,
        },
      })
        .then(() => {
          if (saveSequenceRef.current !== sequence) return;
          setSettingsStatus("saved");
        })
        .catch((error) => {
          if (saveSequenceRef.current !== sequence) return;
          setSettingsStatus("error");
          setSettingsError(toUiError(error, "updateRulesFailed"));
        });
    }, 220);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    draftCpuCount,
    draftGameMode,
    draftRoundSeconds,
    draftTotalRounds,
    draftsReady,
    hostCanEdit,
    roomId,
    roomStatus,
    settingsDirty,
  ]);

  useEffect(() => {
    if (!draftsReady || !hostCanEdit) return;
    if (draftCpuCount <= maxCpuCount) return;
    setDraftCpuCount(maxCpuCount);
  }, [draftCpuCount, draftsReady, hostCanEdit, maxCpuCount]);

  useEffect(() => {
    if (!draftsReady) return;

    const normalized = normalizeRoundSecondsForMode(
      draftGameMode,
      draftRoundSeconds,
    );
    if (normalized !== draftRoundSeconds) {
      setDraftRoundSeconds(normalized);
    }
  }, [draftGameMode, draftRoundSeconds, draftsReady]);

  useEffect(() => {
    if (settingsDirty) return;
    setSettingsError(null);
    if (settingsStatus === "error") {
      setSettingsStatus("idle");
    }
  }, [settingsDirty, settingsStatus]);

  useEffect(() => {
    if (settingsStatus !== "saved") return;
    const timerId = window.setTimeout(() => {
      setSettingsStatus("idle");
    }, 900);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [settingsStatus]);

  useRoomPresence({
    roomId,
    enabled: Boolean(room && user) && !isLeaving,
  });

  const updateReady = useCallback(async (
    nextReady: boolean,
    options?: { silent?: boolean },
  ) => {
    setActionBusy("ready");
    if (!options?.silent) {
      setActionError(null);
    }
    setOptimisticReady(nextReady);
    try {
      await apiPost("/api/rooms/ready", {
        roomId,
        ready: nextReady,
      });
    } catch (error) {
      setOptimisticReady(null);
      if (!options?.silent) {
        setActionError(toUiError(error, "readyUpdateFailed"));
      }
    } finally {
      setActionBusy(null);
    }
  }, [roomId]);

  useEffect(() => {
    if (roomStatus !== "LOBBY" || !me || isLeaving) return;
    if (me.ready || optimisticReady === true) return;
    if (actionBusy === "ready" || autoReadyAttemptedRef.current) return;

    autoReadyAttemptedRef.current = true;
    void updateReady(true, { silent: true });
  }, [actionBusy, isLeaving, me, optimisticReady, roomStatus, updateReady]);

  const onStart = async () => {
    if (!me?.isHost || !canStartRound) return;

    setActionBusy("start");
    setActionError(null);
    try {
      await apiPost("/api/rounds/start", {
        roomId,
      });
      router.push(buildCurrentAppPath(`/round/${roomId}`));
    } catch (error) {
      setActionError(toUiError(error, "startRoundFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const onLeave = async () => {
    setIsLeaving(true);
    setActionBusy("leave");
    setActionError(null);
    try {
      await leaveRoom({ roomId });
      router.replace(buildCurrentAppPath("/"));
    } catch (error) {
      setIsLeaving(false);
      setActionError(toUiError(error, "leaveRoomFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const onShufflePlayers = async () => {
    if (!canShufflePlayers) return;

    setActionBusy("shuffle");
    setActionError(null);
    try {
      await apiPost("/api/rooms/shuffle-order", {
        roomId,
      });
    } catch (error) {
      setActionError(toUiError(error, "shufflePlayersFailed"));
    } finally {
      setActionBusy(null);
    }
  };

  const copyCode = async () => {
    if (!room?.code) return;

    try {
      await navigator.clipboard.writeText(room.code);
      setCopyStatus("done");
      window.setTimeout(() => setCopyStatus("idle"), 1400);
    } catch {
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  };

  const settingsStatusMessage = (() => {
    if (settingsError) {
      return resolveUiErrorMessage(language, settingsError);
    }

    return null;
  })();

  const lobbyStatusMessage = (() => {
    if (actionError) {
      return resolveUiErrorMessage(language, actionError);
    }

    return null;
  })();
  const preparationMessage = (() => {
    if (nextRoundPreparation?.status === "FAILED") {
      return copy.lobby.nextRoundFallback;
    }

    return null;
  })();

  if (isLeaving || loading || (isConnecting && !snapshotError && !room)) {
    return (
      <main className="mx-auto flex h-[100dvh] items-center justify-center overflow-y-auto p-6">
        <Card className="bg-white">{copy.lobby.loading}</Card>
      </main>
    );
  }

  if (authError) {
    return (
      <main className="mx-auto flex h-[100dvh] items-center justify-center overflow-y-auto p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {resolveUiErrorMessage(language, authError)}
          </p>
        </Card>
      </main>
    );
  }

  if (snapshotError) {
    return (
      <main className="mx-auto flex h-[100dvh] items-center justify-center overflow-y-auto p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {copy.lobby.roomInfoFetchFailed(snapshotError.message)}
          </p>
        </Card>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="mx-auto flex h-[100dvh] items-center justify-center overflow-y-auto p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {copy.lobby.roomInfoUnavailable}
          </p>
        </Card>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="mx-auto flex h-[100dvh] items-center justify-center overflow-y-auto p-6">
        <Card className="bg-white">
          <p className="text-sm font-semibold text-[var(--pmb-red)]">
            {copy.lobby.roomSessionMismatch}
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="page-enter mx-auto flex h-[100dvh] w-full max-w-[174dvh] flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-3 md:px-4 md:py-3">
      <Card className="overflow-hidden bg-white p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 bg-[var(--pmb-yellow)] px-4 py-3 md:px-5">
          <div>
            <p className="text-[11px] font-black tracking-[0.24em] uppercase">
              {copy.lobby.roomCode}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-[1.75rem] font-black tracking-[0.28em] md:text-[2.15rem]">
                {room.code}
              </h1>

              <Button
                onClick={copyCode}
                type="button"
                variant="ghost"
                aria-label={
                  copyStatus === "done"
                    ? copy.lobby.copied
                    : copy.lobby.copyRoomCode
                }
                className={[
                  "h-10 w-10 p-0",
                  "hover:translate-x-0 hover:-translate-y-0 hover:shadow-[6px_6px_0_var(--pmb-ink)]",
                  "active:translate-x-0.5 active:translate-y-0.5 active:shadow-[4px_4px_0_var(--pmb-ink)]",
                  copyStatus === "done"
                    ? "bg-[var(--pmb-green)] text-[var(--pmb-ink)]"
                    : "",
                  copyStatus === "error"
                    ? "bg-[var(--pmb-red)] text-white"
                    : "",
                ].join(" ")}
              >
                {copyStatus === "done" ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Copy className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-stretch justify-end gap-2 self-stretch">
            <div className="flex">
              <Button
                type="button"
                variant="ghost"
                onClick={onLeave}
                disabled={actionBusy !== null}
                className="h-full min-h-[62px] px-5 text-base"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {copy.lobby.leave}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <section className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(220px,250px)_minmax(0,1fr)] xl:grid-cols-[minmax(230px,260px)_minmax(0,1fr)]">
        <Card className="relative flex min-h-0 flex-col bg-white p-3 md:p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-2xl font-black md:text-[1.7rem]">
              <Users className="h-5 w-5" /> {copy.lobby.players}
            </h2>
          </div>

          <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {displayPlayers.map((player) => {
              const isSelf = player.uid === user?.uid;

              return (
                <div
                  key={player.uid}
                  className={[
                    "flex items-center gap-2 rounded-[14px] border-2 border-[var(--pmb-ink)] px-3 py-2",
                    isSelf ? "bg-[var(--pmb-yellow)]" : "bg-[var(--pmb-base)]",
                  ].join(" ")}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-black md:text-[15px]">
                      {player.displayName}
                    </span>
                    {player.kind === "cpu" ? (
                      <Badge className="bg-white px-2 py-0 text-[10px]">
                        <Bot className="mr-1 h-3 w-3" /> {copy.common.cpu}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative mt-3 border-t-4 border-[var(--pmb-ink)] pt-2">
            {me?.isHost ? (
              <div className="mb-2 sm:absolute sm:right-0 sm:bottom-full sm:mb-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onShufflePlayers}
                  disabled={!canShufflePlayers}
                  className="h-11 min-w-[168px] px-4 text-sm font-black"
                >
                  {actionBusy === "shuffle" ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shuffle className="mr-2 h-4 w-4" />
                  )}
                  {copy.lobby.shufflePlayers}
                </Button>
              </div>
            ) : null}

            {me?.isHost ? (
              <Button
                type="button"
                variant="accent"
                onClick={onStart}
                disabled={!canStartRound}
                className={[
                  "w-full",
                  !canStartRound
                    ? "bg-zinc-300 text-zinc-600 disabled:opacity-100"
                    : "",
                ].join(" ")}
              >
                {isGenerating || actionBusy === "start" ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isGenerating
                  ? copy.lobby.generatingTheme
                  : copy.lobby.startRound}
              </Button>
            ) : (
              <p className="flex items-center rounded-[12px] border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 text-sm font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_70%,white)]">
                {isGenerating ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {isGenerating
                  ? copy.lobby.generatingTheme
                  : copy.lobby.waitingForHost}
              </p>
            )}

            {lobbyStatusMessage ? (
              <p
                className={[
                  "mt-2 text-xs font-semibold",
                  "text-[var(--pmb-red)]",
                ].join(" ")}
              >
                {lobbyStatusMessage}
              </p>
            ) : null}

            {!lobbyStatusMessage && preparationMessage ? (
              <p className="mt-2 text-xs font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_72%,white)]">
                {preparationMessage}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_minmax(0,0.42fr)] overflow-hidden bg-white p-3 md:p-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-3xl leading-none font-black md:text-[2.15rem]">
                <Gamepad2 className="h-6 w-6" /> {copy.lobby.gameMode}
              </h2>
            </div>

            {settingsStatusMessage ? (
              <div
                className={[
                  "mt-2 flex items-center gap-1.5 text-[11px] font-semibold",
                  "text-[var(--pmb-red)]",
                ].join(" ")}
              >
                <span>{settingsStatusMessage}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-3 grid min-h-0 items-stretch gap-3 xl:grid-cols-[minmax(150px,0.24fr)_minmax(0,0.76fr)]">
            <div className="grid min-h-0 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-1 xl:grid-rows-4">
              {gameModeOptions.map((mode) => {
                const selected = draftGameMode === mode.mode;
                const Icon =
                  mode.mode === "classic"
                    ? Eye
                    : mode.mode === "memory"
                      ? Brain
                      : mode.mode === "change"
                        ? Sparkles
                        : Ghost;

                return (
                  <button
                    key={mode.mode}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (!hostCanEdit) return;
                      const enteringChangeMode =
                        mode.mode === "change" && draftGameMode !== "change";
                      const leavingChangeMode =
                        draftGameMode === "change" && mode.mode !== "change";
                      setDraftGameMode(mode.mode);
                      setDraftRoundSeconds(
                        enteringChangeMode
                          ? CHANGE_DEFAULT_ROUND_SECONDS
                          : leavingChangeMode
                            ? STANDARD_DEFAULT_ROUND_SECONDS
                            : normalizeRoundSecondsForMode(
                                mode.mode,
                                draftRoundSeconds,
                              ),
                      );
                    }}
                    disabled={!hostCanEdit}
                    className={[
                      "group relative flex min-h-[58px] w-full items-center justify-between gap-2 overflow-hidden rounded-[16px] border-4 px-3 py-2 text-left transition-all duration-150 xl:h-full xl:min-h-0",
                      "disabled:cursor-not-allowed disabled:opacity-70",
                      selected
                        ? "border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] shadow-[5px_5px_0_var(--pmb-ink)]"
                        : "border-[var(--pmb-ink)] bg-[var(--pmb-base)] shadow-[3px_3px_0_var(--pmb-ink)] hover:-translate-y-0.5 hover:bg-white hover:shadow-[4px_4px_0_var(--pmb-ink)]",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center">
                      <span className="block truncate text-[0.98rem] leading-tight font-black">
                        {mode.label}
                      </span>
                    </span>
                    <span
                      className={[
                        "grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[var(--pmb-ink)] bg-white transition-transform duration-150",
                        selected ? "rotate-[-5deg]" : "group-hover:rotate-6",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              className="flex min-h-0 min-w-0 items-stretch justify-center overflow-hidden"
              aria-live="polite"
            >
              <AnimatePresence mode="wait">
                <ModeGameplayPreview
                  key={`${currentMode.mode}-${language}`}
                  mode={currentMode.mode}
                  language={language}
                />
              </AnimatePresence>
            </div>
          </div>

          <div className="mt-4 border-t-4 border-[var(--pmb-ink)] pt-3 md:mt-5">
            <h3 className="flex items-center gap-2 text-2xl leading-none md:text-[1.85rem]">
              <ListChecks className="h-6 w-6" />
              {language === "ja" ? "ゲームルール" : "Game Rule"}
            </h3>
          </div>

          <div className="mt-2 grid min-h-0 grid-rows-3 gap-2">
            <SwipeValuePicker
              label="Rounds"
              icon={RotateCcw}
              options={ROUND_OPTIONS}
              value={draftTotalRounds}
              onChange={setDraftTotalRounds}
              disabled={!hostCanEdit}
            />

            <SwipeValuePicker
              label={
                draftGameMode === "change" ? copy.lobby.repeatViews : "Time"
              }
              icon={Clock3}
              options={roundTimeOptions}
              value={draftRoundSeconds}
              onChange={setDraftRoundSeconds}
              disabled={!hostCanEdit}
            />
            {draftGameMode !== "change" ? (
              <SwipeValuePicker
                label="CPU"
                icon={Bot}
                options={cpuOptions}
                value={draftCpuCount}
                onChange={setDraftCpuCount}
                disabled={!hostCanEdit}
              />
            ) : null}
          </div>

          {settingsStatus === "saving" ? (
            <div className="pointer-events-none absolute right-3 bottom-3 rounded-full border-2 border-[var(--pmb-ink)] bg-white p-2 shadow-[3px_3px_0_var(--pmb-ink)]">
              <LoaderCircle className="h-4 w-4 animate-spin" />
            </div>
          ) : null}
        </Card>
      </section>
    </main>
  );
}
