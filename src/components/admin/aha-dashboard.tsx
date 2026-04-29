"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Check,
  CloudUpload,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { NormalizedBox } from "@/lib/types/game";
import { cn } from "@/lib/utils/cn";

interface AdminChange {
  id: string;
  editPrompt: string;
  changeSummary: string;
  fileName: string;
  annotation: NormalizedBox | null;
}

interface AdminTheme {
  slug: string;
  title: string;
  style: string;
  difficulty: number;
  aspectRatio: "1:1" | "16:9" | "9:16";
  tags: string[];
  base: {
    id: string;
    prompt: string;
    fileName: string;
  };
  changes: AdminChange[];
  missingPromptImageIds: string[];
  missingImagePromptIds: string[];
}

interface AssetsResponse {
  ok: boolean;
  themes: AdminTheme[];
  error?: {
    message: string;
  };
}

const SECRET_STORAGE_KEY = "pmb:aha-admin-secret";

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function imageUrl(secret: string, themeSlug: string, assetId: string) {
  const params = new URLSearchParams({
    secret,
    themeSlug,
    assetId,
  });
  return `/api/admin/aha/image?${params.toString()}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function AhaAdminDashboard() {
  const [secret, setSecret] = useState("");
  const [themes, setThemes] = useState<AdminTheme[]>([]);
  const [selectedThemeSlug, setSelectedThemeSlug] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<NormalizedBox | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSecret(localStorage.getItem(SECRET_STORAGE_KEY) ?? "");
  }, []);

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.slug === selectedThemeSlug) ?? themes[0] ?? null,
    [selectedThemeSlug, themes],
  );
  const selectedChange = useMemo(
    () =>
      selectedTheme?.changes.find((change) => change.id === selectedChangeId) ??
      selectedTheme?.changes[0] ??
      null,
    [selectedChangeId, selectedTheme],
  );
  const annotatedCount = themes.reduce(
    (count, theme) =>
      count + theme.changes.filter((change) => Boolean(change.annotation)).length,
    0,
  );
  const changeCount = themes.reduce((count, theme) => count + theme.changes.length, 0);

  useEffect(() => {
    setDraftBox(selectedChange?.annotation ?? null);
  }, [selectedChange?.id, selectedChange?.annotation]);

  async function loadAssets(nextSecret = secret) {
    if (!nextSecret.trim()) {
      setMessage("AHA_ADMIN_SECRET を入力してください。");
      return;
    }

    localStorage.setItem(SECRET_STORAGE_KEY, nextSecret);
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/aha/assets", {
        headers: {
          "x-aha-admin-secret": nextSecret,
        },
        cache: "no-store",
      });
      const json = (await response.json()) as AssetsResponse;
      if (!response.ok || !json.ok) {
        throw new Error(json.error?.message ?? "Failed to load Aha assets.");
      }
      setThemes(json.themes);
      setSelectedThemeSlug((current) => current ?? json.themes[0]?.slug ?? null);
      setSelectedChangeId((current) => current ?? json.themes[0]?.changes[0]?.id ?? null);
      setMessage(`Loaded ${json.themes.length} themes.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function saveAnnotation() {
    if (!selectedTheme || !selectedChange || !draftBox) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/aha/annotation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aha-admin-secret": secret,
        },
        body: JSON.stringify({
          themeSlug: selectedTheme.slug,
          changeId: selectedChange.id,
          answerBox: draftBox,
        }),
      });
      const json = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!response.ok || !json.ok) {
        throw new Error(json.error?.message ?? "Failed to save annotation.");
      }
      setThemes((current) =>
        current.map((theme) =>
          theme.slug === selectedTheme.slug
            ? {
                ...theme,
                changes: theme.changes.map((change) =>
                  change.id === selectedChange.id
                    ? { ...change, annotation: draftBox }
                    : change,
                ),
              }
            : theme,
        ),
      );
      setMessage("Annotation saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/aha/publish", {
        method: "POST",
        headers: {
          "x-aha-admin-secret": secret,
        },
      });
      const json = (await response.json()) as {
        ok: boolean;
        themes?: number;
        changes?: number;
        skippedUnannotated?: number;
        error?: { message: string };
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.error?.message ?? "Failed to publish assets.");
      }
      setMessage(
        `Published ${json.themes ?? 0} themes / ${json.changes ?? 0} changes. Skipped ${json.skippedUnannotated ?? 0}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-4 border-[var(--pmb-ink)] bg-[var(--pmb-yellow)] p-4 shadow-[8px_8px_0_var(--pmb-ink)]">
        <div>
          <p className="text-xs font-black tracking-[0.18em] uppercase">
            Local Aha Catalog
          </p>
          <h1 className="mt-1 text-4xl leading-none md:text-5xl">Annotation Desk</h1>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
          <label className="min-w-[240px] flex-1 md:w-[320px]">
            <span className="mb-1 block text-xs font-black uppercase">Secret</span>
            <Input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="AHA_ADMIN_SECRET"
              className="bg-white"
            />
          </label>
          <Button type="button" onClick={() => loadAssets()} disabled={loading}>
            {loading ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Load
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={publish}
            disabled={publishing || annotatedCount === 0}
          >
            {publishing ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CloudUpload className="mr-2 h-4 w-4" />
            )}
            Publish
          </Button>
        </div>
      </header>

      {message ? (
        <Card className="bg-white py-3 text-sm font-bold">{message}</Card>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="min-h-0 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black uppercase">Themes</p>
            <Badge className="bg-[var(--pmb-blue)]">
              {annotatedCount}/{changeCount}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {themes.map((theme) => {
              const done = theme.changes.filter((change) => change.annotation).length;
              return (
                <button
                  key={theme.slug}
                  type="button"
                  onClick={() => {
                    setSelectedThemeSlug(theme.slug);
                    setSelectedChangeId(theme.changes[0]?.id ?? null);
                  }}
                  className={cn(
                    "rounded-lg border-2 border-[var(--pmb-ink)] p-3 text-left text-sm font-bold",
                    selectedTheme?.slug === theme.slug
                      ? "bg-[var(--pmb-yellow)]"
                      : "bg-[var(--pmb-base)]",
                  )}
                >
                  <span className="block">{theme.title}</span>
                  <span className="mt-1 block font-mono text-xs">
                    {done}/{theme.changes.length} annotated
                  </span>
                  {theme.missingPromptImageIds.length > 0 ? (
                    <span className="mt-1 block text-xs text-[var(--pmb-red)]">
                      missing prompts: {theme.missingPromptImageIds.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>

        {selectedTheme && selectedChange ? (
          <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="min-h-0 bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase">{selectedTheme.style}</p>
                  <h2 className="text-2xl">{selectedTheme.title}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{selectedTheme.aspectRatio}</Badge>
                  <Badge className="bg-white">difficulty {selectedTheme.difficulty}</Badge>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <figure>
                  <figcaption className="mb-1 flex items-center gap-1 text-xs font-black uppercase">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Base
                  </figcaption>
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-white">
                    <Image
                      src={imageUrl(secret, selectedTheme.slug, selectedTheme.base.id)}
                      alt=""
                      fill
                      unoptimized
                      sizes="(min-width: 1024px) 50vw, 100vw"
                      className="object-contain"
                    />
                  </div>
                </figure>
                <figure>
                  <figcaption className="mb-1 flex items-center gap-1 text-xs font-black uppercase">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Changed
                  </figcaption>
                  <AnnotationImage
                    src={imageUrl(secret, selectedTheme.slug, selectedChange.id)}
                    box={draftBox}
                    onChange={setDraftBox}
                  />
                </figure>
              </div>
            </Card>

            <Card className="min-h-0 bg-white p-3">
              <p className="text-sm font-black uppercase">Changes</p>
              <div className="mt-3 grid max-h-[260px] gap-2 overflow-y-auto pr-1">
                {selectedTheme.changes.map((change) => (
                  <button
                    key={change.id}
                    type="button"
                    onClick={() => setSelectedChangeId(change.id)}
                    className={cn(
                      "rounded-lg border-2 border-[var(--pmb-ink)] p-2 text-left text-xs font-bold",
                      selectedChange.id === change.id
                        ? "bg-[var(--pmb-blue)]"
                        : "bg-[var(--pmb-base)]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {change.annotation ? <Check className="h-4 w-4" /> : null}
                      {change.id}
                    </span>
                    <span className="mt-1 block font-sans">{change.changeSummary}</span>
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                <p className="text-xs font-black uppercase">Answer Box</p>
                <p className="mt-1 font-mono text-xs">
                  {draftBox
                    ? `${formatPercent(draftBox.x)}, ${formatPercent(draftBox.y)}, ${formatPercent(draftBox.width)}, ${formatPercent(draftBox.height)}`
                    : "not set"}
                </p>
              </div>

              <Button
                type="button"
                className="mt-4 w-full"
                onClick={saveAnnotation}
                disabled={!draftBox || saving}
              >
                {saving ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Box
              </Button>

              <div className="mt-4 max-h-[240px] overflow-y-auto rounded-lg border-2 border-[var(--pmb-ink)] bg-[var(--pmb-base)] p-3">
                <p className="text-xs font-black uppercase">Edit Prompt</p>
                <p className="mt-2 text-xs font-semibold break-words">
                  {selectedChange.editPrompt}
                </p>
              </div>
            </Card>
          </section>
        ) : (
          <Card className="flex min-h-[420px] items-center justify-center bg-white text-sm font-bold">
            Load local Aha assets.
          </Card>
        )}
      </div>
    </main>
  );
}

function AnnotationImage({
  src,
  box,
  onChange,
}: {
  src: string;
  box: NormalizedBox | null;
  onChange: (box: NormalizedBox) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function pointFromEvent(event: PointerEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  }

  function updateBox(point: { x: number; y: number }) {
    const start = startRef.current;
    if (!start) return;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const width = Math.abs(start.x - point.x);
    const height = Math.abs(start.y - point.y);
    if (width > 0.002 && height > 0.002) {
      onChange({ x, y, width, height });
    }
  }

  return (
    <div
      ref={ref}
      className="relative aspect-video w-full touch-none overflow-hidden rounded-lg border-4 border-[var(--pmb-ink)] bg-white"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        startRef.current = pointFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (!startRef.current) return;
        updateBox(pointFromEvent(event));
      }}
      onPointerUp={(event) => {
        updateBox(pointFromEvent(event));
        startRef.current = null;
      }}
      onPointerCancel={() => {
        startRef.current = null;
      }}
    >
      <Image
        src={src}
        alt=""
        fill
        unoptimized
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="object-contain"
        draggable={false}
      />
      {box ? (
        <div
          className="pointer-events-none absolute bg-[var(--pmb-red)]/35 shadow-[0_0_0_9999px_rgba(0,0,0,0.28),inset_0_0_0_1px_rgba(255,255,255,0.9)]"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}
