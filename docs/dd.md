# PrompDojo Design Doc

最終更新: 2026-04-06

## 1. Summary

- UI とページ遷移はそのまま維持する。
- 基盤は Vercel + personal Firestore + minimal Cloud Storage + Gemini API を使う。
- 認証は Firebase 匿名認証ではなく、署名付き匿名 session cookie を使う。
- リアルタイム同期は Firestore Web SDK 直結ではなく、`/api/rooms/[roomId]/events` の SSE で行う。
- 最終採点は Gemini の画像対画像評価のみを使い、embedding / cosine は使わない。
- 各ラウンドの生成は 1 回だけ、hint 機能は使わない。

## 2. Architecture

```text
[Browser]
  - POST /api/auth/anonymous
  - POST /api/rooms/*
  - POST /api/rounds/*
  - GET  /api/rooms/[roomId]/events?view=...

        |
        v

[Next.js on Vercel]
  - session cookie verification
  - Firestore reads/writes via @google-cloud/firestore
  - Cloud Storage uploads via @google-cloud/storage
  - Gemini API key calls via @google/genai

[Personal Firebase / GCP]
  - Firestore
  - Cloud Storage
  - Optional Cloud Scheduler -> Vercel cleanup route (OIDC)

[Gemini API]
  - text prompt generation
  - image generation
  - captioning
  - visual judging
```

## 3. Auth

- 初回アクセス時に `POST /api/auth/anonymous` を呼び、`uid` を含む署名付き cookie を発行する。
- 既存の gameplay mutation routes は path と request body を維持する。
- API 認証は `Authorization: Bearer ...` ではなく same-origin cookie を使う。

## 4. Data Model

コレクション構造は維持する:

```text
rooms/{roomId}
  players/{uid}
  rounds/{roundId}
  rounds_private/{roundId}
  rounds/{roundId}/scores/{uid}
  rounds/{roundId}/attempts_private/{uid}
```

`rounds_private` には以下を保存する:

- `gmPrompt`
- `gmNegativePrompt`
- `targetCaptionJson`
- `targetCaptionText`
- `safety`

`targetEmbedding` 系は廃止した。

## 5. Realtime

- クライアントは Firestore を直接 subscribe しない。
- `GET /api/rooms/[roomId]/events?view=lobby|round|results|transition` で snapshot を SSE 配信する。
- 各 snapshot は画面に必要な `room / players / round / scores / attempts` をまとめて返す。

## 6. Round Generation

- `POST /api/rounds/start` は room settings と同 room の過去ラウンド要約を Gemini に渡してお題を生成する。
- 以前の固定 pool / seed / fallback は使わない。
- Gemini 失敗時は room status と round index をロールバックする。

## 7. Scoring

- `POST /api/rounds/submit` の流れ:
  1. attempt を予約
  2. 画像生成
  3. 画像 caption を生成
  4. ターゲット画像と回答画像を Gemini で比較し score を決定
  5. `best.png` を保存
  6. score / ranking / totalScore を更新
- judge 失敗時は reservation を補償トランザクションで取り消し、attempt は消費しない。
- `caption -> embedding -> cosine` は完全に削除した。

## 8. Hint

- path 互換性のため `POST /api/rounds/hint` は残すが、常に disabled response を返す。
- hint image の生成・保存は行わない。

## 9. Deployment

- 公開入口は Vercel。
- Firestore / Cloud Storage は personal Firebase / GCP project を使う。
- Gemini は `GEMINI_API_KEY` を使い、Vertex AI / WIF / IAP 前提は持たない。
- Vercel では `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON`、ローカルでは ADC を使う。
- cleanup は手動実行でき、必要なら Cloud Scheduler の OIDC token で `POST /api/maintenance/cleanup` を叩く。
