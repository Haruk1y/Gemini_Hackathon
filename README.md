# PrompDojo

Prompt engineering meets party game.  
Gemini が作ったお題画像を見て、元のプロンプトを推理し、どれだけ近い画像を再生成できるかを競う対戦ゲームです。

## What Changed

- Firebase Auth / Firestore client / Storage client 依存を撤去
- 認証を匿名 session cookie に変更
- リアルタイム同期を Firestore `onSnapshot` から SSE に変更
- Gemini 呼び出しを `GEMINI_API_KEY` 前提に簡素化
- お題生成の固定 seed/pool を廃止し、Gemini が毎回お題仕様を生成
- `caption -> embedding -> cosine` を削除し、最終スコアを画像対画像評価だけで決定
- ゲームルールを `1ラウンド1回生成 / ヒントなし` に簡素化
- Storage 保存を `target.png` と `best.png` のみへ削減

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Vercel
- Personal Firebase / Google Cloud Firestore
- Personal Google Cloud Storage
- Gemini API (`@google/genai`)
- Google Cloud Scheduler (optional)
- Tailwind CSS
- Vitest + Playwright

## Environment Variables

Copy `.env.example` to `.env.local`.

```bash
cp .env.example .env.local
```

Required values:

- `GOOGLE_CLOUD_PROJECT`
- `GCS_BUCKET`
- `SESSION_SECRET`
- `GEMINI_API_KEY`

Optional values:

- `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON`
- `GEMINI_TEXT_MODEL`
- `GEMINI_IMAGE_MODEL`
- `MOCK_GEMINI`
- `APP_BASE_URL`
- `SCHEDULER_OIDC_AUDIENCE`

## Local Development

Local development uses Google Cloud ADC for Firestore / Cloud Storage.
On Vercel, use a personal service account JSON in `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` to access the same Firestore / bucket.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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
- Room state is streamed from `GET /api/rooms/[roomId]/events?view=...` over Server-Sent Events.
- Images are stored in Cloud Storage under:
  - `rooms/{roomId}/rounds/{roundId}/target.png`
  - `rooms/{roomId}/rounds/{roundId}/players/{uid}/best.png`

## Deployment

Deploy the Next.js app to Vercel. Keep Firestore, Cloud Storage, and optional Cloud Scheduler in your personal Firebase / GCP project.

Runtime access to Google Cloud is expected to work through:

- `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` on Vercel
- ADC locally
- `GEMINI_API_KEY` for Gemini image generation, captioning, and judging

The cleanup route can be invoked manually, or by Google Cloud Scheduler with an OIDC token:

- `POST /api/maintenance/cleanup`

Set Cloud Scheduler to target the Vercel production URL and verify the token against `SCHEDULER_OIDC_AUDIENCE`.

## Notes

- The public entrypoint is Vercel, so Google Cloud IAP is not part of this setup.
- Room settings always resolve to `1` attempt and `0` hints even if a client sends other values.
- If `MOCK_GEMINI=true`, image generation and judging use safe mock behavior for local development.
