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
- Neon Postgres
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
- `DATABASE_URL` (Neon Postgres, required for the theme catalog database only)

Optional values:

- `IMAGE_PROVIDER_DEFAULT`
- `AHA_ADMIN_SECRET` (local-only Aha asset annotation dashboard)
- `AHA_SOURCE_DIR` (defaults to `/Users/yajima/Documents/aha`)
- `GEMINI_TEXT_MODEL`
- `GEMINI_IMAGE_MODEL`
- `MOCK_GEMINI`
- `VERTEX_PROJECT_ID`
- `VERTEX_LOCATION`
- `VERTEX_ENDPOINT_ID`
- `VERTEX_ENDPOINT_HOST`
- `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON`
- `GCP_PROJECT_ID`
- `GCP_PROJECT_NUMBER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_WORKLOAD_IDENTITY_POOL_ID`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`

Notes:

- `GEMINI_API_KEY` is still required even when room image generation uses Flux. GM prompt generation, CPU rewrite, captioning, and image judging remain on Gemini.
- `IMAGE_PROVIDER_DEFAULT` controls the default Create Room image model on the home screen.
- `GEMINI_PROMPT_MODEL_DEFAULT` and `GEMINI_JUDGE_MODEL_DEFAULT` control the default `Prompt Model` / `Judge Model` toggles on the home screen.
- `VERTEX_PROJECT_ID` can fall back to `GCP_PROJECT_ID`, but setting both explicitly is the least confusing option.
- Local Flux development uses `gcloud auth application-default login`.
- Vercel production in this project currently uses `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` for Flux because the target GCP org blocks Vercel OIDC provider creation.
- If your GCP org later allows `https://oidc.vercel.com`, the app still supports `Vercel OIDC + GCP Workload Identity Federation` via the full `GCP_*` block.

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
- `npm run db:theme:check`
- `npm run db:theme:migrate`
- `npm run eval:models`

## Theme Catalog Database

The approved-theme catalog is stored in a separate Neon Postgres database. Aha Moment (`change`) mode reads approved catalog changes first. In local development it falls back to the existing real-time Gemini generation when the catalog is empty or unavailable; in production the catalog is required.

Recommended setup:

1. Add Neon from the Vercel Marketplace so `DATABASE_URL` is injected into the Vercel project.
2. Pull env vars locally with `vercel env pull .env.local --yes`, or set `DATABASE_URL` manually for local testing.
3. Run `npm run db:theme:check` to verify the connection.
4. Run `npm run db:theme:migrate` to create the theme catalog tables.

The schema stores prompt metadata and Blob URLs/paths only. Image files remain in Vercel Blob.
For Aha Moment (`change`) mode, `theme_catalog_items` stores the base image theme, while `theme_catalog_changes` stores each approved/rejected image-change pattern with its edit prompt, changed image Blob path, answer box, and feedback counters.

## Local Aha Asset Publishing

Local source assets live under `AHA_SOURCE_DIR` and default to `/Users/yajima/Documents/aha`. Start the app locally, open `/admin/aha`, enter `AHA_ADMIN_SECRET`, and load the local catalog.

Workflow:

1. Select a theme/change pair.
2. Drag the answer box on the changed image.
3. Save the annotation.
4. Publish when the intended changes are annotated.

The publish action uploads images to Vercel Blob using stable paths like `aha/{themeSlug}/{baseId}/base.png` and `aha/{themeSlug}/{baseId}/changes/{changeId}.png`, then upserts approved rows into Neon. Unannotated changes are skipped.

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

Deploy the Next.js app to Vercel Production only. Preview is not part of the supported Flux / Redis / Blob setup for this project.

- Add the Upstash Redis integration and copy `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- Create a Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`
- Set `SESSION_SECRET`, `CRON_SECRET`, and `GEMINI_API_KEY`
- Set `IMAGE_PROVIDER_DEFAULT=flux` if you want new rooms to default to Flux
- Set `GEMINI_PROMPT_MODEL_DEFAULT=flash-lite` and `GEMINI_JUDGE_MODEL_DEFAULT=flash-lite` if you want the debug toggles to default to Flash-Lite
- Set `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_ENDPOINT_ID`, and `VERTEX_ENDPOINT_HOST`
- Set `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` to a service account JSON for a principal that already has `roles/aiplatform.user` on the Vertex project
- Do not set `GOOGLE_APPLICATION_CREDENTIALS` on Vercel
- If org policy later allows Vercel OIDC providers, you can replace the JSON secret with `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, and `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`
- `vercel.json` runs cleanup once per day against `/api/maintenance/cleanup`
- The round creation routes use `runtime = "nodejs"` plus explicit `maxDuration` so `after()` can finish prewarming and CPU continuation work on Vercel

Recommended production checklist:

- `npm run test`
- `npm run build`
- Confirm Production envs are set in Vercel
- Deploy `main`
- Verify room creation, prewarmed round 1, Gemini round start, Flux round start, `Next Round`, replay reset, and cleanup cron

See [docs/vercel-production-deploy-ja.md](docs/vercel-production-deploy-ja.md) for the project-specific production steps.

## Fast Model Eval

When you want to compare `gemini-2.5-flash` and `gemini-2.5-flash-lite` before changing live gameplay behavior, use the local benchmark script:

```bash
gcloud auth application-default login
npm run eval:models
```

Useful flags:

- `npm run eval:models -- --smoke`
- `npm run eval:models -- --include-claude`
- `npm run eval:models -- --output docs/model-eval-latest.json`

Useful env override:

- `MODEL_EVAL_GCP_PROJECT_ID=sc-ai-innovation-lab-2-dev npm run eval:models`

What it measures:

- GM prompt generation with structured JSON output
- Visual judge scoring with image input + structured JSON output
- p50 / p95 latency
- schema success rate
- judge sanity via `same / near / different` score ordering
- optional Claude 3.5 Haiku access probe on Vertex Model Garden

See [docs/fast-model-eval-ja.md](docs/fast-model-eval-ja.md) for the eval flow and interpretation.

## Notes

- Room settings always resolve to `1` attempt and `0` hints even if a client sends other values.
- If `MOCK_GEMINI=true`, image generation and judging use safe mock behavior for local development.
- Legacy rooms that still store `imageModel: "flash"` are normalized to `gemini` on read.
