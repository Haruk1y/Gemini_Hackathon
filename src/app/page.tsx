"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { useAuth } from "@/components/providers/auth-provider";

export default function HomePage() {
  const router = useRouter();
  const { loading, error: authError } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [totalRounds, setTotalRounds] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    !loading && !authError && !busy && displayName.trim().length >= 1;

  const createRoom = async () => {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<{ ok: true; roomId: string }>(
        "/api/rooms/create",
        {
          displayName,
          settings: {
            roundSeconds: 60,
            maxAttempts: 1,
            totalRounds: Number(totalRounds),
            hintLimit: 0,
            maxPlayers: 8,
            aspectRatio: "1:1",
          },
        },
      );

      router.push(`/lobby/${response.roomId}`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("ルーム作成に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    if (!canSubmit || joinCode.trim().length !== 6) return;

    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<{ ok: true; roomId: string }>(
        "/api/rooms/join",
        {
          code: joinCode.trim().toUpperCase(),
          displayName,
        },
      );
      router.push(`/lobby/${response.roomId}`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
      } else {
        setError("ルーム参加に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-enter mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card className="bg-[var(--pmb-yellow)] p-6 md:p-8">
          <h1 className="text-3xl leading-tight md:text-5xl">PrompDojo</h1>
          <p className="mt-3 max-w-xl text-base font-semibold leading-relaxed md:text-xl">
            お題画像を見てプロンプトを推理しよう！
            <br />
            最も近い画像を生成したプレイヤーが勝利！
          </p>
        </Card>

        <Card className="space-y-4 bg-white p-6">
          <h2 className="text-xl">プレイヤー情報</h2>
          <div className="space-y-1">
            <p className="text-xs font-bold">表示名</p>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="表示名（1文字以上）"
              maxLength={24}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold">ルームコード</p>
            <Input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ルームコード（6文字）"
              maxLength={6}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold">ラウンド数</p>
            <select
              value={totalRounds}
              onChange={(event) => setTotalRounds(event.target.value)}
              className="w-full rounded-[10px] border-4 border-[var(--pmb-ink)] bg-white px-3 py-2 text-sm text-[var(--pmb-ink)] focus:outline-none focus:ring-4 focus:ring-[var(--pmb-blue)]/30"
            >
              {[1, 2, 3, 4, 5].map((roundCount) => (
                <option key={roundCount} value={roundCount}>
                  {roundCount}ラウンド
                </option>
              ))}
            </select>
            <p className="text-xs font-semibold text-[color:color-mix(in_srgb,var(--pmb-ink)_72%,white)]">
              1人でもプレイできます。各ラウンドの生成は1回だけ、ヒントはありません。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={createRoom} disabled={!canSubmit}>
              ルーム作成
            </Button>
            <Button onClick={joinRoom} variant="accent" disabled={!canSubmit || joinCode.length !== 6}>
              ルーム参加
            </Button>
          </div>
          {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
          {authError ? (
            <p className="text-sm font-semibold text-[var(--pmb-red)]">
              {authError}
            </p>
          ) : null}
        </Card>
      </header>
    </main>
  );
}
