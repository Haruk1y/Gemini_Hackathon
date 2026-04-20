# PrompDojo

Prompt engineering meets party game.  
AI が作ったお題画像を見て、元のプロンプトを推理し、どれだけ近い画像を再生成できるかを競う対戦ゲームです。

## What Changed

- Firebase Auth / Firestore client / Storage client 依存を撤去
- 認証を匿名 session cookie に変更
- リアルタイム同期を lightweight snapshot polling に変更
- Gemini 呼び出しを `GEMINI_API_KEY` 前提に簡素化
- お題生成の固定 seed/pool を廃止し、Gemini が毎回お題仕様を生成
- `caption -> embedding -> cosine` を削除し、最終スコアを画像対画像評価だけで決定
- ゲームルールを `1ラウンド1回生成 / ヒントなし` に簡素化
- Storage 保存を `target.png` と `best.png` のみへ削減
- 状態保存を Firestore から Upstash Redis へ移行
- 画像保存を Google Cloud Storage から Vercel Blob へ移行
- cleanup を Google Cloud Scheduler から Vercel Cron へ移行
- 画像生成プロバイダをルーム単位で `Gemini` / `Flux (Vertex custom endpoint)` から切り替え可能に変更
- ルーム作成直後に `1ラウンド目` を先読み生成し、以後も常に `次の1ラウンド分` をバックグラウンドで準備するように変更
- 再プレイ時の round/image 再利用を避けるため、表示用 `roundIndex` と保存用 `roundId` を分離

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Vercel
- Upstash Redis
- Vercel Blob
- Gemini API (`@google/genai`)
- Vertex AI custom endpoint (optional for Flux image generation)
- Vercel Cron Jobs
- Tailwind CSS
- Vitest + Playwright

## Environment Variables

Copy `.env.example` to `.env.local`.

```bash
cp .env.example .env.local
```

Required values:

- `SESSION_SECRET`
- `GEMINI_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`

Optional values:

- `IMAGE_PROVIDER_DEFAULT`
- `GEMINI_TEXT_MODEL`
- `GEMINI_IMAGE_MODEL`
- `MOCK_GEMINI`
- `VERTEX_PROJECT_ID`
- `VERTEX_LOCATION`
- `VERTEX_ENDPOINT_ID`
- `VERTEX_ENDPOINT_HOST`
- `GCP_PROJECT_ID`
- `GCP_PROJECT_NUMBER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_WORKLOAD_IDENTITY_POOL_ID`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`

Notes:

- `GEMINI_API_KEY` is still required even when room image generation uses Flux. GM prompt generation, CPU rewrite, captioning, and image judging remain on Gemini.
- `IMAGE_PROVIDER_DEFAULT` controls the default Create Room setting on the home screen.
- `VERTEX_PROJECT_ID` can fall back to `GCP_PROJECT_ID`, but setting both explicitly is the least confusing option.
- Local Flux development uses `gcloud auth application-default login`.
- Vercel production should use `Vercel OIDC + GCP Workload Identity Federation`.

## Local Development

Local development uses the same Redis / Blob / Gemini credentials as production.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

If you want to use Flux locally, set the `VERTEX_*` environment variables and authenticate Application Default Credentials before starting the app:

```bash
gcloud auth application-default login
```

The server prefers `Vercel OIDC + GCP Workload Identity Federation` when the WIF environment variables are present. If they are not present, it falls back to local ADC.

Gameplay note:

- `Create Room` immediately starts preparing round 1 in the background.
- While players are in round `N`, the server tries to prepare round `N+1`.
- If prewarming fails or is still running, `Start Round` / `Next Round` safely fall back to synchronous generation.
- The home screen owns the `Gemini / Flux` selector. The lobby only edits `gameMode`, `totalRounds`, `roundSeconds`, and `cpuCount`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:e2e`

## Runtime Architecture

- Browser bootstraps `POST /api/auth/anonymous` once and receives an HttpOnly session cookie.
- Gameplay mutations continue to use the existing `POST /api/rooms/*` and `POST /api/rounds/*` endpoints.
- Room state is polled from `GET /api/rooms/[roomId]/snapshot?view=...&since=...`.
- Game state is stored in Redis as room-scoped state blobs with versioned polling.
- Room settings include an `imageModel` field chosen at room creation time, so target image generation and player answer generation use the same provider per room.
- `Gemini` remains responsible for GM prompt generation, CPU prompt rewriting, caption generation, and visual judging even when image generation uses Flux.
- GM prompt generation uses local style presets before calling Gemini, so prompts vary across flatter poster, collage, gouache, risograph, clay, and ink-like looks without becoming too visually dense.
- A single prepared-round slot is stored in room state with `GENERATING / READY / FAILED`.
- Round assets are stored under monotonic `roundId`s so replayed rooms do not reuse old target images.
- Images are stored in Vercel Blob under:
  - `rooms/{roomId}/rounds/{roundId}/target.png`
  - `rooms/{roomId}/rounds/{roundId}/players/{uid}/best.png`

## Deployment

Deploy the Next.js app to Vercel.

- Add the Upstash Redis integration and copy `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- Create a Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`
- Set `SESSION_SECRET`, `CRON_SECRET`, and `GEMINI_API_KEY`
- Set `IMAGE_PROVIDER_DEFAULT` if you want new rooms to default to `flux`
- If you use Flux in production, create a dedicated Google Cloud service account with `roles/aiplatform.user`
- Prefer `Vercel OIDC + GCP Workload Identity Federation` instead of storing a long-lived JSON service account key in Vercel
- Set `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_ENDPOINT_ID`, `VERTEX_ENDPOINT_HOST`, `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, and `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`
- `vercel.json` runs cleanup once per day against `/api/maintenance/cleanup`
- The round creation routes use `runtime = "nodejs"` plus explicit `maxDuration` so `after()` can finish prewarming and CPU continuation work on Vercel

## Notes

- Room settings always resolve to `1` attempt and `0` hints even if a client sends other values.
- If `MOCK_GEMINI=true`, image generation and judging use safe mock behavior for local development.
- Legacy rooms that still store `imageModel: "flash"` are normalized to `gemini` on read.
