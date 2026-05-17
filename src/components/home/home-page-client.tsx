"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Coins, Settings, Target, Trophy } from "lucide-react";

import { useLanguage } from "@/components/providers/language-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { apiPost } from "@/lib/client/api";
import { buildCurrentAppPath } from "@/lib/client/paths";
import {
  type UiError,
  resolveUiErrorMessage,
  toUiError,
} from "@/lib/i18n/errors";
import type { ImageModel, TextModelVariant } from "@/lib/types/game";

type BusyAction = "create" | "join" | null;
type HomeMenuTab = "daily" | "achievements" | "settings";

const COIN_STORAGE_KEY = "pmb:coins";
const CLAIMED_QUESTS_STORAGE_KEY = "pmb:claimed-daily-quests";
const CLAIMED_ACHIEVEMENTS_STORAGE_KEY = "pmb:claimed-achievements";

const IMAGE_MODEL_OPTIONS: Array<{ value: ImageModel; label: string }> = [
  { value: "gemini", label: "Gemini" },
  { value: "flux", label: "Flux" },
];

const DAILY_QUESTS = [
  {
    id: "classic-three",
    current: 2,
    target: 3,
    reward: 40,
  },
  {
    id: "score-seventy",
    current: 1,
    target: 1,
    reward: 80,
  },
  {
    id: "change-clear",
    current: 0,
    target: 1,
    reward: 60,
  },
] as const;

const ACHIEVEMENTS = [
  {
    id: "classic-play",
    category: "play",
    current: 12,
    milestones: [
      { id: "classic-play-10", target: 10, reward: 120 },
      { id: "classic-play-50", target: 50, reward: 300 },
      { id: "classic-play-100", target: 100, reward: 600 },
    ],
  },
  {
    id: "impostor-win",
    category: "play",
    current: 3,
    milestones: [
      { id: "impostor-win-5", target: 5, reward: 180 },
      { id: "impostor-win-25", target: 25, reward: 520 },
      { id: "impostor-win-100", target: 100, reward: 1200 },
    ],
  },
  {
    id: "score-ninety",
    category: "score",
    current: 2,
    milestones: [
      { id: "score-ninety-3", target: 3, reward: 160 },
      { id: "score-ninety-10", target: 10, reward: 420 },
      { id: "score-ninety-50", target: 50, reward: 1000 },
    ],
  },
  {
    id: "change-clear",
    category: "score",
    current: 1,
    milestones: [
      { id: "change-clear-5", target: 5, reward: 140 },
      { id: "change-clear-20", target: 20, reward: 460 },
      { id: "change-clear-100", target: 100, reward: 1100 },
    ],
  },
  {
    id: "avatar-unlock",
    category: "collection",
    current: 1,
    milestones: [
      { id: "avatar-unlock-1", target: 1, reward: 90 },
      { id: "avatar-unlock-5", target: 5, reward: 260 },
      { id: "avatar-unlock-20", target: 20, reward: 780 },
    ],
  },
  {
    id: "login-days",
    category: "collection",
    current: 4,
    milestones: [
      { id: "login-days-7", target: 7, reward: 130 },
      { id: "login-days-30", target: 30, reward: 500 },
      { id: "login-days-100", target: 100, reward: 1300 },
    ],
  },
] as const;

const ACHIEVEMENT_CATEGORIES = ["play", "score", "collection"] as const;

interface HomePageClientProps {
  initialImageModel: ImageModel;
  initialPromptModel: TextModelVariant;
  initialJudgeModel: TextModelVariant;
}

function DebugToggleGroup<T extends string>(params: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-black tracking-[0.14em] uppercase">
        {params.label}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {params.options.map((option) => {
          const selected = params.value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => params.onChange(option.value)}
              className={[
                "rounded-[12px] border-4 px-3 py-2 text-center text-xs font-black tracking-[0.08em] uppercase transition-transform duration-150",
                selected
                  ? "border-[var(--pmb-ink)] bg-[var(--pmb-blue)] shadow-[4px_4px_0_var(--pmb-ink)]"
                  : "border-[var(--pmb-ink)] bg-white shadow-[2px_2px_0_var(--pmb-ink)]",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HomeMenuButton(params: {
  active: boolean;
  label: string;
  icon: ReactNode;
  showAlert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={params.onClick}
      className={[
        "relative inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border-4 px-3 py-2 text-xs font-black tracking-[0.08em] uppercase transition-transform duration-150",
        params.active
          ? "border-[var(--pmb-ink)] bg-[var(--pmb-blue)] shadow-[4px_4px_0_var(--pmb-ink)]"
          : "border-[var(--pmb-ink)] bg-white shadow-[2px_2px_0_var(--pmb-ink)]",
      ].join(" ")}
    >
      {params.icon}
      {params.label}
      {params.showAlert ? (
        <span
          aria-label="unclaimed rewards"
          className="absolute -top-3 -right-3 inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[var(--pmb-red)] text-xs font-black text-white shadow-[2px_2px_0_var(--pmb-ink)]"
        >
          !
        </span>
      ) : null}
    </button>
  );
}

export default function HomePageClient({
  initialImageModel,
  initialPromptModel,
  initialJudgeModel,
}: HomePageClientProps) {
  const router = useRouter();
  const { language, copy } = useLanguage();
  const { loading, error: authError } = useAuth();

  const [createDisplayName, setCreateDisplayName] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createImageModel, setCreateImageModel] =
    useState<ImageModel>(initialImageModel);
  const [createPromptModel, setCreatePromptModel] =
    useState<TextModelVariant>(initialPromptModel);
  const [createJudgeModel, setCreateJudgeModel] =
    useState<TextModelVariant>(initialJudgeModel);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [createError, setCreateError] = useState<UiError | null>(null);
  const [joinError, setJoinError] = useState<UiError | null>(null);
  const [activeMenuTab, setActiveMenuTab] = useState<HomeMenuTab>("settings");
  const [coins, setCoins] = useState(120);
  const [claimedQuestIds, setClaimedQuestIds] = useState<string[]>([]);
  const [claimedAchievementIds, setClaimedAchievementIds] = useState<string[]>(
    [],
  );

  useEffect(() => {
    const savedCoins = window.localStorage.getItem(COIN_STORAGE_KEY);
    const parsedCoins = savedCoins === null ? NaN : Number(savedCoins);
    if (Number.isFinite(parsedCoins)) {
      setCoins(parsedCoins);
    }

    const savedClaimed = window.localStorage.getItem(
      CLAIMED_QUESTS_STORAGE_KEY,
    );
    if (savedClaimed) {
      try {
        const parsed = JSON.parse(savedClaimed);
        if (Array.isArray(parsed)) {
          setClaimedQuestIds(
            parsed.filter(
              (value): value is string => typeof value === "string",
            ),
          );
        }
      } catch {
        window.localStorage.removeItem(CLAIMED_QUESTS_STORAGE_KEY);
      }
    }

    const savedAchievements = window.localStorage.getItem(
      CLAIMED_ACHIEVEMENTS_STORAGE_KEY,
    );
    if (savedAchievements) {
      try {
        const parsed = JSON.parse(savedAchievements);
        if (Array.isArray(parsed)) {
          setClaimedAchievementIds(
            parsed.filter(
              (value): value is string => typeof value === "string",
            ),
          );
        }
      } catch {
        window.localStorage.removeItem(CLAIMED_ACHIEVEMENTS_STORAGE_KEY);
      }
    }
  }, []);

  const textModelOptions: Array<{
    value: TextModelVariant;
    label: string;
  }> = [
    { value: "flash", label: copy.common.flash },
    { value: "flash-lite", label: copy.common.flashLite },
  ];

  const createDisabled =
    loading ||
    Boolean(authError) ||
    busyAction !== null ||
    createDisplayName.trim().length < 1;
  const joinDisabled =
    loading ||
    Boolean(authError) ||
    busyAction !== null ||
    joinDisplayName.trim().length < 1 ||
    joinCode.trim().length !== 6;
  const claimableQuests = DAILY_QUESTS.filter(
    (quest) =>
      quest.current >= quest.target && !claimedQuestIds.includes(quest.id),
  );
  const claimableReward = claimableQuests.reduce(
    (total, quest) => total + quest.reward,
    0,
  );

  const claimQuestReward = (questId: string, reward: number) => {
    if (claimedQuestIds.includes(questId)) return;

    const nextCoins = coins + reward;
    const nextClaimedQuestIds = [...claimedQuestIds, questId];

    setCoins(nextCoins);
    setClaimedQuestIds(nextClaimedQuestIds);
    window.localStorage.setItem(COIN_STORAGE_KEY, String(nextCoins));
    window.localStorage.setItem(
      CLAIMED_QUESTS_STORAGE_KEY,
      JSON.stringify(nextClaimedQuestIds),
    );
  };

  const claimAllQuestRewards = () => {
    if (claimableQuests.length < 1) return;

    const nextCoins = coins + claimableReward;
    const nextClaimedQuestIds = Array.from(
      new Set([
        ...claimedQuestIds,
        ...claimableQuests.map((quest) => quest.id),
      ]),
    );

    setCoins(nextCoins);
    setClaimedQuestIds(nextClaimedQuestIds);
    window.localStorage.setItem(COIN_STORAGE_KEY, String(nextCoins));
    window.localStorage.setItem(
      CLAIMED_QUESTS_STORAGE_KEY,
      JSON.stringify(nextClaimedQuestIds),
    );
  };

  const claimAchievementReward = (achievementId: string, reward: number) => {
    if (claimedAchievementIds.includes(achievementId)) return;

    const nextCoins = coins + reward;
    const nextClaimedAchievementIds = [...claimedAchievementIds, achievementId];

    setCoins(nextCoins);
    setClaimedAchievementIds(nextClaimedAchievementIds);
    window.localStorage.setItem(COIN_STORAGE_KEY, String(nextCoins));
    window.localStorage.setItem(
      CLAIMED_ACHIEVEMENTS_STORAGE_KEY,
      JSON.stringify(nextClaimedAchievementIds),
    );
  };

  const getActiveAchievementMilestone = (
    achievement: (typeof ACHIEVEMENTS)[number],
  ) =>
    achievement.milestones.find(
      (milestone) => !claimedAchievementIds.includes(milestone.id),
    ) ?? achievement.milestones[achievement.milestones.length - 1];
  const claimableAchievements = ACHIEVEMENTS.map((achievement) => ({
    achievement,
    milestone: getActiveAchievementMilestone(achievement),
  })).filter(
    ({ achievement, milestone }) =>
      achievement.current >= milestone.target &&
      !claimedAchievementIds.includes(milestone.id),
  );
  const claimableAchievementReward = claimableAchievements.reduce(
    (total, { milestone }) => total + milestone.reward,
    0,
  );

  const claimAllAchievementRewards = () => {
    if (claimableAchievements.length < 1) return;

    const nextCoins = coins + claimableAchievementReward;
    const nextClaimedAchievementIds = Array.from(
      new Set([
        ...claimedAchievementIds,
        ...claimableAchievements.map(({ milestone }) => milestone.id),
      ]),
    );

    setCoins(nextCoins);
    setClaimedAchievementIds(nextClaimedAchievementIds);
    window.localStorage.setItem(COIN_STORAGE_KEY, String(nextCoins));
    window.localStorage.setItem(
      CLAIMED_ACHIEVEMENTS_STORAGE_KEY,
      JSON.stringify(nextClaimedAchievementIds),
    );
  };

  const getDailyQuestText = (quest: (typeof DAILY_QUESTS)[number]) => {
    switch (quest.id) {
      case "classic-three":
        return {
          title: copy.home.dailyQuestClassicTitle,
          description: copy.home.dailyQuestClassicDescription,
        };
      case "score-seventy":
        return {
          title: copy.home.dailyQuestScoreTitle,
          description: copy.home.dailyQuestScoreDescription,
        };
      case "change-clear":
        return {
          title: copy.home.dailyQuestChangeTitle,
          description: copy.home.dailyQuestChangeDescription,
        };
    }
  };

  const getAchievementCategoryLabel = (
    category: (typeof ACHIEVEMENT_CATEGORIES)[number],
  ) => {
    switch (category) {
      case "play":
        return copy.home.achievementPlayCategory;
      case "score":
        return copy.home.achievementScoreCategory;
      case "collection":
        return copy.home.achievementCollectionCategory;
    }
  };

  const getAchievementText = (
    achievement: (typeof ACHIEVEMENTS)[number],
    target: number,
  ) => {
    switch (achievement.id) {
      case "classic-play":
        return {
          title: copy.home.achievementClassicPlayTitle(target),
          description: copy.home.achievementClassicPlayDescription(target),
        };
      case "impostor-win":
        return {
          title: copy.home.achievementImpostorWinTitle(target),
          description: copy.home.achievementImpostorWinDescription(target),
        };
      case "score-ninety":
        return {
          title: copy.home.achievementScoreNinetyTitle(target),
          description: copy.home.achievementScoreNinetyDescription(target),
        };
      case "change-clear":
        return {
          title: copy.home.achievementChangeClearTitle(target),
          description: copy.home.achievementChangeClearDescription(target),
        };
      case "avatar-unlock":
        return {
          title: copy.home.achievementAvatarTitle(target),
          description: copy.home.achievementAvatarDescription(target),
        };
      case "login-days":
        return {
          title: copy.home.achievementLoginTitle(target),
          description: copy.home.achievementLoginDescription(target),
        };
      default:
        return {
          title: copy.home.achievements,
          description: copy.home.achievementGenericDescription(target),
        };
    }
  };

  const createRoom = async () => {
    if (createDisabled) return;

    setBusyAction("create");
    setCreateError(null);
    setJoinError(null);

    try {
      const response = await apiPost<{ ok: true; roomId: string }>(
        "/api/rooms/create",
        {
          displayName: createDisplayName.trim(),
          settings: {
            imageModel: createImageModel,
            promptModel: createPromptModel,
            judgeModel: createJudgeModel,
          },
        },
      );

      router.push(buildCurrentAppPath(`/lobby/${response.roomId}`));
    } catch (e) {
      setCreateError(toUiError(e, "createRoomFailed"));
    } finally {
      setBusyAction(null);
    }
  };

  const joinRoom = async () => {
    if (joinDisabled) return;

    setBusyAction("join");
    setCreateError(null);
    setJoinError(null);

    try {
      const response = await apiPost<{ ok: true; roomId: string }>(
        "/api/rooms/join",
        {
          code: joinCode.trim().toUpperCase(),
          displayName: joinDisplayName.trim(),
        },
      );
      router.push(buildCurrentAppPath(`/lobby/${response.roomId}`));
    } catch (e) {
      setJoinError(toUiError(e, "joinRoomFailed"));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <main className="page-enter mx-auto flex h-[100dvh] w-full flex-col gap-6 overflow-y-auto px-4 py-8 md:px-8">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="relative min-w-0 bg-[var(--pmb-yellow)] p-6 md:p-8">
          <div className="min-w-0">
            <h1 className="pr-36 text-3xl leading-tight md:text-5xl">
              PrompDojo
            </h1>
            <p className="mt-3 w-full text-base leading-relaxed font-semibold md:text-xl">
              {copy.home.heroLine1}
              <br />
              {copy.home.heroLine2}
            </p>
          </div>

          <div className="absolute top-6 right-6 inline-flex w-fit min-w-28 items-center justify-center gap-2 rounded-[10px] border-4 border-[var(--pmb-ink)] bg-white px-3 py-2 text-sm font-black whitespace-nowrap shadow-[4px_4px_0_var(--pmb-ink)] md:top-8 md:right-8">
            <Coins size={18} aria-hidden="true" />
            {copy.home.coins(coins)}
          </div>

          <div className="mt-7">
            <div className="grid max-w-xl grid-cols-3 gap-3">
              <HomeMenuButton
                active={activeMenuTab === "settings"}
                label={copy.home.settings}
                icon={<Settings size={17} aria-hidden="true" />}
                onClick={() => setActiveMenuTab("settings")}
              />
              <HomeMenuButton
                active={activeMenuTab === "daily"}
                label={copy.home.dailyQuest}
                icon={<Target size={17} aria-hidden="true" />}
                showAlert={claimableQuests.length > 0}
                onClick={() => setActiveMenuTab("daily")}
              />
              <HomeMenuButton
                active={activeMenuTab === "achievements"}
                label={copy.home.achievements}
                icon={<Trophy size={17} aria-hidden="true" />}
                showAlert={claimableAchievements.length > 0}
                onClick={() => setActiveMenuTab("achievements")}
              />
            </div>

            {activeMenuTab === "daily" ? (
              <div className="mt-4 h-[23rem] w-full max-w-xl min-w-0 overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white p-3 shadow-[4px_4px_0_var(--pmb-ink)]">
                <div className="mb-2 flex items-center justify-between gap-3 rounded-[10px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2">
                  <p className="text-xs font-black">
                    {copy.home.claimableRewards(claimableReward)}
                  </p>
                  <Button
                    type="button"
                    disabled={claimableQuests.length < 1}
                    onClick={claimAllQuestRewards}
                    className="min-h-0 w-32 shrink-0 px-2 py-1 text-[11px] whitespace-nowrap shadow-[3px_3px_0_var(--pmb-ink)]"
                  >
                    {copy.home.claimAllRewards}
                  </Button>
                </div>
                <div className="grid gap-2">
                  {DAILY_QUESTS.map((quest) => {
                    const questText = getDailyQuestText(quest);
                    const complete = quest.current >= quest.target;
                    const claimed = claimedQuestIds.includes(quest.id);
                    const progressPercent = Math.min(
                      100,
                      Math.round((quest.current / quest.target) * 100),
                    );

                    return (
                      <div
                        key={quest.id}
                        className="rounded-[10px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-2.5"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-[13px] leading-tight font-black">
                                {questText.title}
                              </p>
                              {complete ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pmb-green)] px-2 py-0.5 text-[9px] font-black tracking-[0.08em] uppercase">
                                  <CheckCircle2 size={13} aria-hidden="true" />
                                  {copy.home.missionComplete}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[11px] leading-tight font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_62%,white)]">
                              {questText.description}
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="text-[11px] leading-tight font-black">
                              {copy.home.progress(quest.current, quest.target)}
                            </p>
                            <p className="text-[11px] leading-tight font-black text-[color:color-mix(in_srgb,var(--pmb-ink)_62%,white)]">
                              +{quest.reward}
                            </p>
                          </div>

                          <Button
                            type="button"
                            variant={complete && !claimed ? "primary" : "ghost"}
                            disabled={!complete || claimed}
                            onClick={() =>
                              claimQuestReward(quest.id, quest.reward)
                            }
                            className="min-h-0 w-28 shrink-0 px-2 py-1 text-[10px] whitespace-nowrap shadow-[3px_3px_0_var(--pmb-ink)] sm:w-32 sm:px-3 sm:text-[11px]"
                          >
                            {claimed
                              ? copy.home.rewardClaimed
                              : copy.home.claimReward(quest.reward)}
                          </Button>
                        </div>

                        <div className="mt-2 h-2.5 rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)]">
                          <div
                            className="h-full rounded-full bg-[var(--pmb-blue)]"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : activeMenuTab === "achievements" ? (
              <div className="mt-4 h-[23rem] max-w-xl overflow-y-auto rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white p-3 shadow-[4px_4px_0_var(--pmb-ink)]">
                <div className="mb-2 flex items-center justify-between gap-3 rounded-[10px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-3 py-2">
                  <p className="text-xs font-black">
                    {copy.home.claimableRewards(claimableAchievementReward)}
                  </p>
                  <Button
                    type="button"
                    disabled={claimableAchievements.length < 1}
                    onClick={claimAllAchievementRewards}
                    className="min-h-0 w-32 shrink-0 px-2 py-1 text-[11px] whitespace-nowrap shadow-[3px_3px_0_var(--pmb-ink)]"
                  >
                    {copy.home.claimAllRewards}
                  </Button>
                </div>
                <div className="grid gap-3">
                  {ACHIEVEMENT_CATEGORIES.map((category) => (
                    <div
                      key={category}
                      className="rounded-[10px] border-4 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-2.5"
                    >
                      <p className="mb-2 text-[11px] font-black tracking-[0.08em] uppercase">
                        {getAchievementCategoryLabel(category)}
                      </p>
                      <div className="grid gap-2">
                        {ACHIEVEMENTS.filter(
                          (achievement) => achievement.category === category,
                        ).map((achievement) => {
                          const milestone =
                            getActiveAchievementMilestone(achievement);
                          const achievementText = getAchievementText(
                            achievement,
                            milestone.target,
                          );
                          const complete =
                            achievement.current >= milestone.target;
                          const claimed = claimedAchievementIds.includes(
                            milestone.id,
                          );
                          const progressPercent = Math.min(
                            100,
                            Math.round(
                              (achievement.current / milestone.target) * 100,
                            ),
                          );

                          return (
                            <div
                              key={achievement.id}
                              className="rounded-[10px] border-4 border-[var(--pmb-ink)] bg-white p-2.5"
                            >
                              <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="text-[13px] leading-tight font-black">
                                      {achievementText.title}
                                    </p>
                                    {complete ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pmb-green)] px-2 py-0.5 text-[9px] font-black tracking-[0.08em] uppercase">
                                        <CheckCircle2
                                          size={13}
                                          aria-hidden="true"
                                        />
                                        {copy.home.missionComplete}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-0.5 text-[11px] leading-tight font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_62%,white)]">
                                    {achievementText.description}
                                  </p>
                                </div>

                                <div className="shrink-0 text-right">
                                  <p className="text-[11px] leading-tight font-black">
                                    {copy.home.progress(
                                      achievement.current,
                                      milestone.target,
                                    )}
                                  </p>
                                  <p className="text-[11px] leading-tight font-black text-[color:color-mix(in_srgb,var(--pmb-ink)_62%,white)]">
                                    +{milestone.reward}
                                  </p>
                                </div>

                                <Button
                                  type="button"
                                  variant={
                                    complete && !claimed ? "primary" : "ghost"
                                  }
                                  disabled={!complete || claimed}
                                  onClick={() =>
                                    claimAchievementReward(
                                      milestone.id,
                                      milestone.reward,
                                    )
                                  }
                                  className="min-h-0 w-28 shrink-0 px-2 py-1 text-[10px] whitespace-nowrap shadow-[3px_3px_0_var(--pmb-ink)] sm:w-32 sm:px-3 sm:text-[11px]"
                                >
                                  {claimed
                                    ? copy.home.rewardClaimed
                                    : copy.home.claimReward(milestone.reward)}
                                </Button>
                              </div>

                              <div className="mt-2 h-2.5 rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)]">
                                <div
                                  className="h-full rounded-full bg-[var(--pmb-blue)]"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 h-[23rem] max-w-xl overflow-hidden rounded-[12px] border-4 border-[var(--pmb-ink)] bg-white p-4 shadow-[4px_4px_0_var(--pmb-ink)]">
                <div className="space-y-2">
                  <p className="text-xs font-black tracking-[0.14em] uppercase">
                    Language
                  </p>
                  <LanguageToggle />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2 sm:w-[calc((100%_-_1rem)/2)]">
                    <DebugToggleGroup
                      label={copy.home.imageModelDebug}
                      value={createImageModel}
                      options={IMAGE_MODEL_OPTIONS}
                      onChange={setCreateImageModel}
                    />
                  </div>
                  <DebugToggleGroup
                    label={copy.home.promptModelDebug}
                    value={createPromptModel}
                    options={textModelOptions}
                    onChange={setCreatePromptModel}
                  />
                  <DebugToggleGroup
                    label={copy.home.judgeModelDebug}
                    value={createJudgeModel}
                    options={textModelOptions}
                    onChange={setCreateJudgeModel}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="bg-white p-6">
            <p className="text-xs font-black tracking-[0.18em] text-[color:color-mix(in_srgb,var(--pmb-ink)_68%,white)] uppercase">
              Create Room
            </p>
            <h2 className="mt-2 text-2xl">{copy.home.createRoomTitle}</h2>

            <div className="mt-4 space-y-1">
              <p className="text-xs font-bold">{copy.home.displayNameLabel}</p>
              <Input
                value={createDisplayName}
                onChange={(event) => setCreateDisplayName(event.target.value)}
                placeholder={copy.home.displayNamePlaceholder}
                maxLength={24}
              />
            </div>

            <Button
              onClick={createRoom}
              disabled={createDisabled}
              className="mt-5 w-full"
            >
              {busyAction === "create"
                ? copy.home.creatingRoom
                : copy.home.createRoom}
            </Button>

            {createError ? (
              <p className="mt-3 text-sm font-semibold text-[var(--pmb-red)]">
                {resolveUiErrorMessage(language, createError)}
              </p>
            ) : null}
          </Card>

          <Card className="bg-[var(--pmb-base)] p-6">
            <p className="text-xs font-black tracking-[0.18em] text-[color:color-mix(in_srgb,var(--pmb-ink)_68%,white)] uppercase">
              Join Room
            </p>
            <h2 className="mt-2 text-2xl">{copy.home.joinRoomTitle}</h2>

            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-bold">
                  {copy.home.displayNameLabel}
                </p>
                <Input
                  value={joinDisplayName}
                  onChange={(event) => setJoinDisplayName(event.target.value)}
                  placeholder={copy.home.displayNamePlaceholder}
                  maxLength={24}
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-bold">{copy.home.roomCodeLabel}</p>
                <Input
                  value={joinCode}
                  onChange={(event) =>
                    setJoinCode(event.target.value.toUpperCase())
                  }
                  placeholder={copy.home.roomCodePlaceholder}
                  maxLength={6}
                />
              </div>
            </div>

            <Button
              onClick={joinRoom}
              variant="accent"
              disabled={joinDisabled}
              className="mt-5 w-full"
            >
              {busyAction === "join"
                ? copy.home.joiningRoom
                : copy.home.joinRoom}
            </Button>

            {joinError ? (
              <p className="mt-3 text-sm font-semibold text-[var(--pmb-red)]">
                {resolveUiErrorMessage(language, joinError)}
              </p>
            ) : null}
          </Card>
        </div>
      </header>

      {authError ? (
        <p className="text-sm font-semibold text-[var(--pmb-red)]">
          {resolveUiErrorMessage(language, authError)}
        </p>
      ) : null}
    </main>
  );
}
