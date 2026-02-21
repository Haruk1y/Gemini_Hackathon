# Prompt Mirror Battle

Gemini API と Firebase を使った、マルチプレイ画像生成プロンプトクイズです。

## Features

- ルーム作成/参加/Ready
- ルーム退出・ホスト自動移譲
- 3ラウンド対戦（デフォルト）
- 各ラウンド60秒、2試行、Hint 1回
- Gemini 画像生成 + 埋め込み採点
- Firestore リアルタイム同期
- Neo-brutal Pop UI
- リザルト共有カード PNG 書き出し
- 24時間期限のクリーンアップ API

## Tech Stack

- Next.js (App Router, TypeScript)
- Firebase (Auth/Firestore/Storage)
- Gemini API (`@google/genai`)
- Tailwind CSS + custom design tokens
- Vitest + Playwright

## Local Setup

1. `.env.example` を `.env.local` にコピーして値を設定
2. 依存関係インストール

```bash
npm install
```

3. 開発サーバー起動

```bash
npm run dev
```

4. ブラウザで `http://localhost:3000`

## Scripts

- `npm run dev` - 開発サーバー
- `npm run build` - 本番ビルド
- `npm run lint` - ESLint
- `npm run typecheck` - TypeScript 型チェック
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

すべてのゲームAPIは `Authorization: Bearer <Firebase ID Token>` 必須です。
