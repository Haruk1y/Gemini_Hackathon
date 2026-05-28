# Gemini_Hackathon Vercel Production Deploy

`Gemini_Hackathon` は Vercel の `Production` のみを正式運用対象にします。`Preview` は Flux / Redis / Blob の本番運用対象にしません。

## 前提

- Vercel project は `gemini-hackathon`
- 本番ブランチは `main`
- ローカル検証は `npm run test` と `npm run build` で済ませる
- Gemini は `GEMINI_API_KEY` を使う
- Flux は fal.ai を使う

## Flux 認証方針

このプロジェクトの Flux 本番認証は `FAL_KEY` を使います。Vertex custom endpoint は旧構成の fallback 扱いです。

理由:

- Vertex custom endpoint は ready / active な endpoint 維持コストが重い
- fal.ai の Klein 4B endpoint は従量課金で、ハッカソン/個人運用に向く

## Vercel Production に入れる env

必須:

- `APP_BASE_URL`
- `SESSION_SECRET`
- `GEMINI_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`
- `IMAGE_PROVIDER_DEFAULT=flux`
- `MOCK_GEMINI=false`
- `GEMINI_TEXT_MODEL=gemini-2.5-flash`
- `GEMINI_IMAGE_MODEL=gemini-2.5-flash-image`
- `FAL_KEY`
- `FLUX_MODEL=fal-ai/flux-2/klein/4b`
- `FLUX_EDIT_MODEL=fal-ai/flux-2/klein/4b/edit`

この project では Production に `GOOGLE_APPLICATION_CREDENTIALS` は設定しません。

`APP_BASE_URL` は canonical な本番 origin を指し、`ASSET_PREFIX` を明示しない場合は embedded / playtest 配信時の asset origin source of truth としても使われます。

任意:

- `ASSET_PREFIX`
- `NEXT_PUBLIC_APP_ORIGIN`

使い分け:

- 通常は `APP_BASE_URL` だけ設定する
- asset の配信先だけ別にしたいときだけ `ASSET_PREFIX` を使う
- クライアント向け origin を `APP_BASE_URL` と別にしたいときだけ `NEXT_PUBLIC_APP_ORIGIN` を使う

## CLI 例

Production env を確認:

```bash
cd /Users/yajima/Documents/Gemini_Hackathon
npx vercel env ls production
```

Production 用 env を追加:

```bash
echo "https://your-project.vercel.app" | npx vercel env add APP_BASE_URL production
echo "flux" | npx vercel env add IMAGE_PROVIDER_DEFAULT production
echo "fal-ai/flux-2/klein/4b" | npx vercel env add FLUX_MODEL production
echo "fal-ai/flux-2/klein/4b/edit" | npx vercel env add FLUX_EDIT_MODEL production
```

`FAL_KEY` と `GEMINI_API_KEY` は Vercel Dashboard か `npx vercel env add ... production` で secret として追加します。

`SESSION_SECRET` を設定し直す:

```bash
echo "replace-with-a-long-random-string" | npx vercel env add SESSION_SECRET production
```

本番デプロイ:

```bash
npm run test
npm run build
npx vercel --prod
```

通常運用では `main` へ反映して Git 連携の Production deploy を使います。

## デプロイ後の確認

- 匿名 session が作られる
- `Create Room` が成功する
- ルーム作成直後に round 1 の先読みが走る
- `Gemini` で `Start Round` できる
- `Flux` で `Start Round` できる
- `Next Round` が動く
- replay 後に前回と同じ target image を再利用しない
- target / best image が Blob に保存される
- cleanup cron が `401` ではなく正常応答する

## ログで見るポイント

```bash
npx vercel logs --since 1h
```

特に見る文字列:

- `BLOB_READ_WRITE_TOKEN is missing`
- `Redis storage is not configured in production`
- `GCP_ERROR`
- `Permission 'aiplatform.googleapis.com/endpoints.predict' denied`

## 切り戻しメモ

- Flux だけ問題がある場合でも、`IMAGE_PROVIDER_DEFAULT=gemini` のままであれば通常利用は継続できる
- home 画面の debug toggle で `Flux` を選んだときだけ Vertex を使う
