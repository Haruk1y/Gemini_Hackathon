# PrompDojo

Prompt engineering meets party game.  
Gemini が作ったお題画像を見て、元のプロンプトを推理し、どれだけ近い画像を再生成できるかを競う対戦ゲームです。

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

## Tech Stack

- Next.js 16 (App Router, TypeScript)
- Vercel
- Upstash Redis
- Vercel Blob
- Gemini API (`@google/genai`)
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

- `GEMINI_TEXT_MODEL`
- `GEMINI_IMAGE_MODEL`
- `MOCK_GEMINI`

## Local Development

Local development uses the same Redis / Blob / Gemini credentials as production.

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
- Room state is polled from `GET /api/rooms/[roomId]/snapshot?view=...&since=...`.
- Game state is stored in Redis as room-scoped state blobs with versioned polling.
- Images are stored in Vercel Blob under:
  - `rooms/{roomId}/rounds/{roundId}/target.png`
  - `rooms/{roomId}/rounds/{roundId}/players/{uid}/best.png`

## Deployment

Deploy the Next.js app to Vercel.

- Add the Upstash Redis integration and copy `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- Create a Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`
- Set `SESSION_SECRET`, `CRON_SECRET`, and `GEMINI_API_KEY`
- `vercel.json` runs cleanup once per day against `/api/maintenance/cleanup`

## Notes

- Room settings always resolve to `1` attempt and `0` hints even if a client sends other values.
- If `MOCK_GEMINI=true`, image generation and judging use safe mock behavior for local development.
