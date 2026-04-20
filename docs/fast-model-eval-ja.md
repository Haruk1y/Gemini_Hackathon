# Fast Model Eval

`Gemini_Hackathon` で `お題生成` と `採点` のモデル切り替えを判断する前に、小さめの実データで比較するためのローカル benchmark 手順です。

## 目的

- `gemini-2.5-flash` と `gemini-2.5-flash-lite` の速度差を見る
- `structured output` が安定するかを確認する
- `scoreImageSimilarity` 相当の judge で `same > near > different` が保てるかを見る
- `Claude 3.5 Haiku` は access が開いたら同じ text benchmark に追加する

## 前提

- ローカルで `gcloud auth application-default login` 済み
- `gcloud config set project ...` か `GCP_PROJECT_ID=...` で GCP project を解決できる
- `npm install` 済み

`Gemini` 側の benchmark は Vertex AI 経由で走ります。  
このスクリプトは本番アプリの設定を変更しません。

## 実行コマンド

通常:

```bash
npm run eval:models
```

Vertex を使う GCP project がアプリ本体の project と別なら、明示しておくのが安全です。

```bash
MODEL_EVAL_GCP_PROJECT_ID=sc-ai-innovation-lab-2-dev npm run eval:models
```

軽い smoke:

```bash
npm run eval:models -- --smoke
```

Claude access もまとめて確認:

```bash
npm run eval:models -- --include-claude
```

結果を JSON で保存:

```bash
npm run eval:models -- --output docs/model-eval-latest.json
```

## 何を測るか

### 1. GM prompt benchmark

- 対象:
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`
  - 将来: `claude-3-5-haiku@20241022`
- ケース数:
  - full: `6 style presets x 2 aspect ratios = 12 cases`
  - smoke: `6 cases`
- 出力:
  - `title`
  - `difficulty`
  - `tags`
  - `prompt`
  - `negativePrompt`
  - `mustInclude`
  - `mustAvoid`
- 指標:
  - schema success rate
  - p50 / p95 latency
  - 人間レビュー用 sample outputs

### 2. Judge benchmark

- 対象:
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`
- ケース:
  - `same`
  - `near`
  - `different`
- 指標:
  - schema success rate
  - p50 / p95 latency
  - `same > different`
  - `near > different`
  - `same >= near`

`near` は macOS では `sips` で同じ元画像の resized variant を作って比較します。  
他環境では `near` が自動で減る場合があります。

## 使っている画像素材

Google の公開サンプル画像を benchmark 用に取得します。

- `scones.jpg`
- `cat.jpg`
- `jetpack.jpg`

同じ URL から毎回取り直さないように、ローカルの temp cache に保存します。

## 結果の見方

理想はこうです。

- `Flash-Lite` が `Flash` より十分速い
- schema success rate が落ちない
- judge で `same` の中央値が高く、`different` の中央値が低い
- GM prompt samples を読んでも、複雑すぎず、画風の幅が保てている

判断の目安:

- `採点`:
  - `Flash-Lite` の ordering が崩れず、schema success が安定していれば切り替え候補
- `お題生成`:
  - `Flash-Lite` が速くても、sample prompts が単調だったり複雑すぎるなら保留
- `Claude`:
  - access が開くまでは benchmark 対象として保留

## 2026-04-21 の quick findings

この環境で `2026-04-21` に `npm run eval:models -- --smoke` を回した結果は次の通りでした。

`--smoke` は軽量化のため `near` ケースを省きます。`near` まで見たいときは full run を使ってください。

- GM prompt benchmark
  - `gemini-2.5-flash`: `6/6` success, `p50 9256ms`
  - `gemini-2.5-flash-lite`: `6/6` success, `p50 1476ms`
- Judge benchmark
  - `gemini-2.5-flash`: `6/6` success, `p50 4594ms`
  - `gemini-2.5-flash-lite`: `6/6` success, `p50 1545ms`
- judge sanity
  - `same` の中央値は両方とも `100`
  - `different` の中央値は両方とも `0`
- `claude-3-5-haiku@20241022`
  - 現在の project では `publisher model not found or your project does not have access` で blocked

つまり現時点では、

- `採点` は `Flash-Lite` がかなり有望
- `お題生成` も `Flash-Lite` をまず比較対象にしてよい
- `Claude` は access 解放後に再比較

## 補足

- この benchmark は本番ゲームの挙動を変えません
- 実運用モデルを切り替える前に、`output` JSON を保存して数件だけでも人間レビューするのがおすすめです
