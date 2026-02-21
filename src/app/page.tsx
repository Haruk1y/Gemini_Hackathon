"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPost, ApiClientError } from "@/lib/client/api";
import { useAuth } from "@/components/providers/auth-provider";
import { hasFirebaseClientConfig } from "@/lib/firebase/client";

export default function HomePage() {
  const router = useRouter();
  const { loading, getIdToken } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    hasFirebaseClientConfig && !loading && !busy && displayName.trim().length >= 1;

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
            maxAttempts: 2,
            totalRounds: 3,
            hintLimit: 1,
            maxPlayers: 8,
            aspectRatio: "1:1",
          },
        },
        getIdToken,
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
        getIdToken,
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
          <p className="mt-3 max-w-xl text-sm font-medium md:text-base">
            お題画像を見てプロンプトを推理しよう！
            <br />
            最も近い画像を生成したプレイヤーが勝利！
          </p>
        </Card>

        <Card className="space-y-4 bg-white p-6">
          <h2 className="text-xl">プレイヤー情報</h2>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="表示名（1文字以上）"
            maxLength={24}
          />
          <Input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="参加コード（6文字）"
            maxLength={6}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={createRoom} disabled={!canSubmit}>
              ルーム作成
            </Button>
            <Button onClick={joinRoom} variant="accent" disabled={!canSubmit || joinCode.length !== 6}>
              ルーム参加
            </Button>
          </div>
          {error ? <p className="text-sm font-semibold text-[var(--pmb-red)]">{error}</p> : null}
          {!hasFirebaseClientConfig ? (
            <p className="text-sm font-semibold text-[var(--pmb-red)]">
              Firebase の環境変数が未設定です。.env.local を設定してください。
            </p>
          ) : null}
        </Card>
      </header>
    </main>
  );
}
