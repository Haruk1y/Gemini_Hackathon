"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
import type { ImageModel } from "@/lib/types/game";

type BusyAction = "create" | "join" | null;

const IMAGE_MODEL_OPTIONS: Array<{ value: ImageModel; label: string }> = [
  { value: "gemini", label: "Gemini" },
  { value: "flux", label: "Flux" },
];

export default function HomePage() {
  const router = useRouter();
  const { language, copy } = useLanguage();
  const { loading, error: authError } = useAuth();

  const [createDisplayName, setCreateDisplayName] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createImageModel, setCreateImageModel] =
    useState<ImageModel>("gemini");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [createError, setCreateError] = useState<UiError | null>(null);
  const [joinError, setJoinError] = useState<UiError | null>(null);

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
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="bg-[var(--pmb-yellow)] p-6 md:p-8">
          <h1 className="text-3xl leading-tight md:text-5xl">PrompDojo</h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed font-semibold md:text-xl">
            {copy.home.heroLine1}
            <br />
            {copy.home.heroLine2}
          </p>
          <div className="mt-5 max-w-xs">
            <p className="text-[10px] font-black tracking-[0.18em] uppercase">
              Debug
            </p>

            <div className="mt-3 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-black tracking-[0.14em] uppercase">
                  Language
                </p>
                <LanguageToggle />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-black tracking-[0.14em] uppercase">
                  Image Model
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {IMAGE_MODEL_OPTIONS.map((option) => {
                    const selected = createImageModel === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setCreateImageModel(option.value)}
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
            </div>
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
