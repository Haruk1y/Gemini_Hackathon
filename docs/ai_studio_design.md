# Google AI Studio 開発向け Design Doc

- 対象プロジェクト: Prompt Mirror Battle
- 文書種別: AI Studio 開発ガイド（プロジェクト専用）
- 最終更新: 2026-02-21
- 参照: `docs/dd.md`（アプリ全体設計）

## 1. 目的と読者

### 1.1 目的
本書は、Prompt Mirror Battle における Google AI Studio の開発運用を標準化するための設計書である。対象は以下。

- AI Studio 上でのプロンプト設計
- オフライン評価と採用判定
- API 実装（`src/lib/gemini/*`, `src/app/api/rounds/*`）への安全な移管

### 1.2 対象読者

- PM: 仕様変更時の品質・体験影響を判断する
- Prompt Engineer: AI Studio 上での実験を設計し、採用候補を作る
- Backend Engineer: 採用済みプロンプトをコードへ反映し、回帰を防ぐ

### 1.3 非目標

- Firebase / Next.js の構成変更
- ランタイム API の追加や変更
- 新ゲームモード追加

## 2. 現行システム対応図

`docs/dd.md` の全体アーキテクチャのうち、AI Studio が関与する境界を以下に定義する。

```text
[AI Studio]
  - Prompt設計
  - Structured Output設計
  - 評価ケース実行
       |
       | (採用された artifact を移管)
       v
[src/lib/gemini/prompts.ts]
[src/lib/gemini/schemas.ts]
[src/lib/gemini/client.ts]
       |
       v
[src/app/api/rounds/start/route.ts]   -> GM生成/お題生成
[src/app/api/rounds/submit/route.ts]  -> 投稿画像採点
[src/app/api/rounds/hint/route.ts]    -> Hint生成/Hint画像
```

境界ルール:

- AI Studio は「設計・評価」までを担当する
- 本番反映は必ず Git PR を通す
- API キーは AI Studio とサーバの双方で秘匿運用し、クライアントへ露出しない

## 3. AI Studio 開発ライフサイクル

1. 企画
- 入力: 変更要求（例: Hint品質改善、誤採点低減）
- 出力: 変更対象 artifact の特定（GM / Caption / Hint）

2. Prompt 設計
- AI Studio で system/user 指示を作成
- Structured Output の JSON 形式を先に固定

3. 実験
- 評価ケース群を使って candidate を複数生成
- 失敗例を収集（過剰創作、schema逸脱、曖昧語）

4. 評価
- 定量: schema準拠率、再現性、スコア安定性
- 定性: UI体験（違和感、わかりやすさ、納得感）

5. 採用判定
- baseline と candidate を比較
- 採用/却下/保留を `PromptReleaseRecord` に記録

6. 実装移管
- `prompts.ts` / `schemas.ts` / `client.ts` へ反映
- API 影響点を確認して PR 提出

7. 監視
- 実運用でエラー率、品質低下、コスト変動を監視
- 問題時は即ロールバック

## 4. Prompt Artifact 仕様

### 4.1 文書上の契約インターフェース `PromptArtifact`

| field | 説明 |
|---|---|
| `name` | artifact 識別名（例: `gm_prompt_generation`） |
| `purpose` | 目的と期待効果 |
| `inputs` | 入力データ（テキスト/画像/ゲーム状態） |
| `constraints` | 禁止事項・品質制約 |
| `output_schema` | 構造化出力仕様 |
| `version` | 版番号（例: `GM.v20260221.1`） |
| `owner` | 責任者 |

### 4.2 Artifact 一覧（本プロジェクト）

| name | purpose | inputs | output_schema | 実装反映先 |
|---|---|---|---|---|
| `gm_prompt_generation` | お題生成の品質安定化 | ルーム設定（難易度/アスペクト比） | `gmPromptSchema` | `src/lib/gemini/prompts.ts`, `src/lib/gemini/schemas.ts` |
| `caption_structuring` | 採点用の画像説明正規化 | 画像 + caption指示 | `captionSchema` | `src/lib/gemini/prompts.ts`, `src/lib/gemini/schemas.ts` |
| `hint_generation` | 差分指示と改善案の提示 | target caption + latest attempt | `hintSchema` | `src/lib/gemini/prompts.ts`, `src/lib/gemini/schemas.ts` |

### 4.3 制約（全 artifact 共通）

- 役割ベース記述を使い、特定モデルIDへの過度依存を避ける
- 出力は必ず JSON へ寄せる
- 有名キャラクター、ロゴ、ブランド名の生成誘導は禁止
- 長文化より「判定可能な具体語」を優先する

## 5. 構造化出力契約

### 5.1 スキーマ方針

- スキーマは `src/lib/gemini/schemas.ts` を正とする
- AI Studio 実験時も同じ論理スキーマを適用する
- Optional を増やす場合は downstream 依存 (`normalize-caption.ts` 等) を同時点検する

### 5.2 破損時フォールバック

1. schema parse 失敗
- API は `GEMINI_ERROR` を返す
- candidate は「不採用」扱い

2. JSON 文字列不正
- retry（既存実装: 250ms, 750ms, 1500ms + jitter）
- 失敗継続なら rollback

3. semantic 破損（形式上は正しいが不適切）
- `failure_signals` 該当として評価落ち
- プロンプト修正後に再実験

## 6. 評価設計

### 6.1 文書上の契約インターフェース `EvaluationCase`

| field | 説明 |
|---|---|
| `case_id` | ケースID（例: `CAP-001`） |
| `scenario` | テスト意図 |
| `input_prompt` | 入力プロンプト/入力画像条件 |
| `expected_signals` | 期待される出力特徴 |
| `failure_signals` | 不採用条件 |
| `score_rubric` | 採点基準 |

### 6.2 合格基準

- schema 準拠率: 100%
- 重大 failure signal 発生率: 0%
- 回帰ケース（既存合格ケース）の維持率: 95%以上
- 体験評価（Round画面での納得感）: 5段階で平均4.0以上

### 6.3 最低評価ケース

1. GM品質
- 曖昧語過多を検出
- 禁止語混入を検出

2. Caption品質
- 主題/色/構図の欠落検出
- 入力順序を変えても正規化結果が安定すること

3. Hint品質
- 差分が具体的で実行可能
- 既存情報の焼き直しのみにならない

4. エラー耐性
- JSON崩れ時に retry → fail-safe へ遷移する

## 7. 移管手順（AI Studio → コード）

### 7.1 文書上の契約インターフェース `MappingContract`

| field | 説明 |
|---|---|
| `artifact` | AI Studio 側 artifact 名 |
| `code_targets` | 反映先ファイル群 |
| `runtime_paths` | 影響 API / 実行経路 |
| `validation` | 反映後に必要な検証 |

### 7.2 対応表

| artifact | code_targets | runtime_paths | validation |
|---|---|---|---|
| `gm_prompt_generation` | `src/lib/gemini/prompts.ts`, `src/lib/gemini/schemas.ts`, `src/lib/gemini/client.ts` | `POST /api/rounds/start` | round開始成功率、生成失敗率 |
| `caption_structuring` | `src/lib/gemini/prompts.ts`, `src/lib/gemini/schemas.ts`, `src/lib/scoring/normalize-caption.ts`, `src/lib/gemini/client.ts` | `POST /api/rounds/submit` | 採点安定性、回帰ケース |
| `hint_generation` | `src/lib/gemini/prompts.ts`, `src/lib/gemini/schemas.ts`, `src/lib/gemini/client.ts` | `POST /api/rounds/hint` | hint有用性、失敗率 |

### 7.3 PR テンプレ（必須項目）

- 変更対象 artifact と version
- baseline 比較結果（合格/不合格ケース）
- 影響 API とロールバック手順
- 実行コマンド結果
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`

## 8. 運用・ガバナンス

### 8.1 機密情報

- API キーをドキュメントに直書きしない
- 実験ログ共有時は入力データの機密情報をマスクする

### 8.2 版管理規則

- 命名規則: `<ARTIFACT>.<YYYYMMDD>.<rev>`
- 例: `GM.20260221.1`, `CAPTION.20260221.2`

### 8.3 変更履歴運用

- すべての採用/却下を `PromptReleaseRecord` で残す
- 2週間以内の品質低下は同一日内 rollback を優先

## 9. 受け入れ基準

文書完成判定チェックリスト:

- Lobby / Round / Results の全フローで AI Studio 関与点が定義されている
- Prompt 変更時の影響ファイル・影響 API を追跡できる
- 新旧比較の判定ルール（採用/却下/保留）が実行可能
- 失敗時の fallback / rollback が具体的に書かれている
- ランタイム API を変更しない前提が維持されている

## 10. 付録

### 10.1 Prompt テンプレ

```text
[Role]
あなたは {role} です。

[Goal]
{goal}

[Inputs]
{inputs}

[Constraints]
{constraints}

[Output]
JSONのみで返す。schema: {schema_name}
```

### 10.2 評価シートテンプレ

| case_id | baseline_pass | candidate_pass | 差分メモ | 判定 |
|---|---|---|---|---|
| CAP-001 | Y/N | Y/N | ... | keep/drop |

### 10.3 リリース記録テンプレ `PromptReleaseRecord`

| field | 説明 |
|---|---|
| `release_id` | リリースID |
| `candidate_version` | 候補版 |
| `baseline_version` | 比較対象版 |
| `metrics` | 定量結果（準拠率、失敗率など） |
| `decision` | `adopt` / `reject` / `hold` |
| `rollback_plan` | 差し戻し手順 |

---

本書は AI Studio 側の設計・評価・移管に特化した補助設計書であり、プロダクト全体仕様は `docs/dd.md` を正本とする。
