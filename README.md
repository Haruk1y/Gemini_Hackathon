# PrompDojo

Prompt engineering meets party game.  
プロンプトエンジニアリングを、みんなで盛り上がる対戦ゲームにしたのが **PrompDojo** です。

## Live Demo / 公開URL

- **Production**: `https://gemini-hackathon-bay.vercel.app`
- **Latest deployment (as of 2026-02-21)**: `https://gemini-hackathon-jgf2z81gg-haruk1ys-projects.vercel.app`

友達にURLを送って、同じルームコードで入ればすぐ対戦できます。  
Share the URL, join the same room code, and you can start battling in seconds.

## What We Built / 何を作ったか

**PrompDojo** is a real-time multiplayer prompt quiz powered by Gemini.  
Gemini が作ったお題画像を見て、プレイヤー全員で「元のプロンプト」を推理し、どれだけ近い画像を作れるかを競います。

- Gemini generates the target image for each round.
- Players submit prompts to recreate it.
- Gemini scores each attempt with visual similarity logic.
- Live ranking updates in real time, then the answer prompt is revealed.

## Features / 主な機能

- ルーム作成 / 参加 / Ready フロー
- 3ラウンド対戦（デフォルト）
- 各ラウンド60秒・2試行
- Gemini 画像生成 + 採点
- リアルタイム順位表示
- リザルト表示 + 正解プロンプト表示
- 24時間期限のデータクリーンアップ
- Neo-brutal Pop UI

## Tech Stack

- Next.js (App Router, TypeScript)
- Firebase (Auth / Firestore / Storage)
- Gemini API (`@google/genai`)
- Tailwind CSS + custom design tokens
- Vitest + Playwright

## Local Setup / ローカル起動

1. Copy `.env.example` to `.env.local` and fill required values.  
   `.env.example` を `.env.local` にコピーして値を設定する。
2. Install dependencies.

```bash
npm install
```

3. Start dev server.

```bash
npm run dev
```

4. Open `http://localhost:3000` (or the port shown in terminal).  
   `http://localhost:3000`（またはターミナルに表示されたポート）を開く。

## Scripts

- `npm run dev` - 開発サーバー / dev server
- `npm run build` - 本番ビルド / production build
- `npm run lint` - ESLint
- `npm run typecheck` - TypeScript 型チェック / type check
- `npm run test` - Vitest
- `npm run test:e2e` - Playwright

## API Endpoints

- `POST /api/rooms/create`
- `POST /api/rooms/join`
- `POST /api/rooms/ready`
- `POST /api/rooms/ping`
- `POST /api/rooms/leave`
- `POST /api/rounds/start`
- `POST /api/rounds/submit`
- `POST /api/rounds/hint`
- `POST /api/rounds/endIfNeeded`
- `POST /api/rounds/next`
- `POST /api/maintenance/cleanup`

All game APIs require `Authorization: Bearer <Firebase ID Token>`.  
すべてのゲームAPIは `Authorization: Bearer <Firebase ID Token>` が必須です。
