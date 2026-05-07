"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";

import { useLanguage } from "@/components/providers/language-provider";
import { apiPost } from "@/lib/client/api";
import type { StampEventData } from "@/lib/client/room-sync";
import { STAMPS } from "@/lib/game/stamps";

type StampResponse = Record<string, unknown> & {
  ok: true;
};

const STAMP_CLIENT_COOLDOWN_MS = 2_500;

function hashStampValue(value: string) {
  return value.split("").reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 9973;
  }, 17);
}

function getStampRainStyle(
  stamp: StampEventData,
  index: number,
): CSSProperties {
  const seed = hashStampValue(`${stamp.id}:${stamp.uid}:${stamp.stampId}`);
  const left = 12 + (seed % 76);
  const drift = ((Math.floor(seed / 7) % 29) - 14) * 0.42;
  const midDrift = drift * 0.34;
  const rotate = (Math.floor(seed / 13) % 41) - 20;
  const rotateMid = rotate * -0.35;
  const scale = 0.96 + (seed % 10) / 100;
  const duration = 4300 + (seed % 900);

  return {
    "--stamp-left": `${left}%`,
    "--stamp-drift": `${drift}vw`,
    "--stamp-mid-drift": `${midDrift}vw`,
    "--stamp-rotate": `${rotate}deg`,
    "--stamp-rotate-mid": `${rotateMid}deg`,
    "--stamp-rotate-end": `${rotate * 0.7}deg`,
    "--stamp-scale": `${scale}`,
    "--stamp-duration": `${duration}ms`,
    "--stamp-delay": `${index * 130}ms`,
  } as CSSProperties;
}

export function StampDock({
  roomId,
  recentStamps,
  disabled = false,
}: {
  roomId: string;
  recentStamps: StampEventData[];
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingStampId, setPendingStampId] = useState<string | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const cooldownTimeoutRef = useRef<number | null>(null);
  const visibleStamps = recentStamps.slice(-8);
  const disabledByState = disabled || coolingDown;

  useEffect(() => {
    return () => {
      if (cooldownTimeoutRef.current != null) {
        window.clearTimeout(cooldownTimeoutRef.current);
      }
    };
  }, []);

  const startCooldown = () => {
    if (cooldownTimeoutRef.current != null) {
      window.clearTimeout(cooldownTimeoutRef.current);
    }

    setCoolingDown(true);
    cooldownTimeoutRef.current = window.setTimeout(() => {
      setCoolingDown(false);
      cooldownTimeoutRef.current = null;
    }, STAMP_CLIENT_COOLDOWN_MS);
  };

  const sendStamp = async (stampId: string) => {
    if (disabledByState || pendingStampId) return;

    setPendingStampId(stampId);
    try {
      await apiPost<StampResponse>("/api/rooms/stamps", {
        roomId,
        stampId,
      });
      startCooldown();
    } catch (error) {
      const apiError = error as { status?: unknown; message?: unknown };
      if (
        apiError.status === 429 ||
        apiError.message === "Stamp cooldown is still active."
      ) {
        startCooldown();
        return;
      }

      console.error("send stamp failed", error);
    } finally {
      setPendingStampId(null);
    }
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        {visibleStamps.map((stamp, index) => (
          <div
            key={stamp.id}
            className="pmb-stamp-rain absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={getStampRainStyle(stamp, index)}
          >
            <div className="rounded-full border-4 border-[var(--pmb-ink)] bg-white/95 px-4 py-3 text-5xl leading-none shadow-[5px_5px_0_var(--pmb-ink)] backdrop-blur-sm">
              {stamp.emoji}
            </div>
            <p className="mt-1 max-w-28 truncate rounded-full border-2 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] px-2 py-0.5 text-[10px] font-black shadow-[2px_2px_0_var(--pmb-ink)]">
              {stamp.displayName}
            </p>
          </div>
        ))}
      </div>

      <div className="pointer-events-none fixed right-3 bottom-3 z-50 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col items-end gap-2 sm:right-5 sm:bottom-5">
        {isOpen ? (
          <div className="pointer-events-auto grid w-full grid-cols-3 gap-2 rounded-xl border-4 border-[var(--pmb-ink)] bg-white p-2 shadow-[7px_7px_0_var(--pmb-ink)]">
            {STAMPS.map((stamp) => (
              <button
                key={stamp.id}
                type="button"
                disabled={disabledByState || pendingStampId !== null}
                onClick={() => sendStamp(stamp.id)}
                className="flex min-h-16 flex-col items-center justify-center rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] px-2 py-2 text-center font-black transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-2xl leading-none">
                  {pendingStampId === stamp.id ? "..." : stamp.emoji}
                </span>
                <span className="mt-1 text-[11px] leading-tight">
                  {language === "ja" ? stamp.label : stamp.labelEn}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          disabled={disabledByState}
          onClick={() => setIsOpen((current) => !current)}
          className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full border-4 border-[var(--pmb-ink)] bg-[var(--pmb-blue)] shadow-[5px_5px_0_var(--pmb-ink)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={language === "ja" ? "スタンプ" : "Stamps"}
        >
          <SmilePlus className="h-7 w-7" />
        </button>
      </div>
    </>
  );
}
