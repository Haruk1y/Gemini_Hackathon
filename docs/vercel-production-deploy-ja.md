# Gemini_Hackathon Vercel Production Deploy

`Gemini_Hackathon` は Vercel の `Production` のみを正式運用対象にします。`Preview` は Flux / Redis / Blob の本番運用対象にしません。

## 前提

- Vercel project は `gemini-hackathon`
- 本番ブランチは `main`
- ローカル検証は `npm run test` と `npm run build` で済ませる
- Gemini は `GEMINI_API_KEY` を使う
- Flux は Vertex custom endpoint を使う

## 認証方針

このプロジェクトの Vertex 本番認証は、現時点では `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` を使います。

理由:

- 対象 GCP project では、org policy により `https://oidc.vercel.com` を issuer にした Workload Identity Federation provider 作成が拒否される
- そのため `Vercel OIDC + GCP WIF` をこの project では現時点で構成できない

将来 org policy が変わったら、`GCP_*` を使う WIF 構成へ切り替え可能です。アプリ側のコードは両方に対応しています。

## Vercel Production に入れる env

必須:

- `SESSION_SECRET`
- `GEMINI_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`
- `IMAGE_PROVIDER_DEFAULT=gemini`
- `MOCK_GEMINI=false`
- `GEMINI_TEXT_MODEL=gemini-2.5-flash`
- `GEMINI_IMAGE_MODEL=gemini-2.5-flash-image`
- `VERTEX_PROJECT_ID`
- `VERTEX_LOCATION`
- `VERTEX_ENDPOINT_ID`
- `VERTEX_ENDPOINT_HOST`
- `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON`

この project では Production に `GOOGLE_APPLICATION_CREDENTIALS` は設定しません。

## Google Cloud 側

Flux 用の service account には、Vertex endpoint を持つ project で最低でも次の権限が必要です。

- `roles/aiplatform.user`

この service account の JSON key を発行し、その JSON 全体を `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON` として Vercel Production に入れます。

## CLI 例

Production env を確認:

```bash
cd /Users/yajima/Documents/Gemini_Hackathon
npx vercel env ls production
```

Production 用 env を追加:

```bash
echo "gemini" | npx vercel env add IMAGE_PROVIDER_DEFAULT production
```

service account JSON を Production に追加:

```bash
cat /path/to/vertex-ai-key.json | npx vercel env add GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON production
```

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
