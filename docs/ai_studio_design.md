# Gemini API Prompt Design Guide

最終更新: 2026-04-06

## Purpose

この文書は PrompDojo における Gemini API artifact の運用ルールをまとめたものです。

対象:

- お題生成 prompt
- 画像 caption structuring
- visual judge rubric

## Runtime Mapping

```text
src/lib/gemini/prompts.ts
src/lib/gemini/schemas.ts
src/lib/gemini/client.ts
        |
        +-> POST /api/rounds/start
        +-> POST /api/rounds/submit
```

## Active Artifacts

### 1. GM prompt generation

- 入力: room settings, same room の過去ラウンド要約
- 出力: `gmPromptSchema`
- 要件:
  - 固定 seed/pool に依存しない
  - 過去ラウンドとの差分を明確にする
  - 著作権・ブランド文字列を避ける

### 2. Caption structuring

- 入力: 画像
- 出力: `captionSchema`
- 用途:
  - results reveal
- 注記:
  - embedding 採点には使わない

### 3. Visual judge

- 入力: target image, attempt image
- 出力: `visualScoreSchema`
- 用途:
  - 最終 score
  - `matchedElements`, `missingElements`, `judgeNote`
- 注記:
  - prompt text は採点に使わない

## Operational Rules

- Gemini API を使う。既定の env は:
  - `GEMINI_API_KEY`
  - `GEMINI_TEXT_MODEL`
  - `GEMINI_IMAGE_MODEL`
- お題生成失敗時は fallback prompt で続行せず、round をロールバックする。
- judge 失敗時は attempt consumption をロールバックする。
- hint 機能は使わず、hint image も生成しない。
- `MOCK_GEMINI=true` はローカル開発専用。
