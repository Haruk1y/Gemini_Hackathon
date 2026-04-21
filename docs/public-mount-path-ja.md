# `/games/prompdojo/play` 実装ガイド

## 背景

このアプリは root (`/`) だけでなく、public mount path である `/games/prompdojo/play` 配下でも正しく動く必要があります。

`/games/prompdojo/play` 配下で壊れる典型例は、次の 4 つです。

- CSS / JS asset を `/_next/...` のような root 固定 URL で参照してしまう
- 画面遷移や API 呼び出しを `/lobby/...` や `/api/...` のような root 固定 URL で組み立ててしまう
- 埋め込み先 host が `_next` を proxy しないのに、asset を current host 相対で読ませてしまう
- cookie / cross-site 配信前提の条件を崩して、埋め込み先や別 origin からのアクセスで認証が外れる

このリポジトリでは、mount path 対応の source of truth を次の 2 箇所に集約しています。

- `next.config.ts`
- `src/lib/client/paths.ts`

新しい実装を追加するときは、まずこの 2 箇所の前提を壊していないかを確認してください。

## 守るべき実装ルール

### 1. asset の公開パスは `next.config.ts` を source of truth にする

`next.config.ts` では次を前提にしています。

- `PUBLIC_MOUNT_PREFIX` は `/games/prompdojo/play`
- `assetPrefix` は `_next` 配下の asset を mount path 配下、または canonical origin 配下で配信するために使う
- `rewrites` は `/games/prompdojo/play/...` をアプリ本体の route へ流す

守ること:

- `_next` 配下の asset URL を手書きしない
- canonical origin が必要な埋め込み配信では、`APP_BASE_URL` を asset origin の source of truth にする
- asset 配信先を明示 override したいときだけ `ASSET_PREFIX` を使う
- `assetPrefix` の既定値や `rewrites` を変更するときは、`/games/prompdojo/play` での表示確認をセットで行う
- 「root では動くが mount path では崩れる」変更は、まず `next.config.ts` の前提を疑う

### 2. 画面遷移は `buildCurrentAppPath()` を使う

クライアント側で画面遷移 URL を組み立てるときは、`src/lib/client/paths.ts` の `buildCurrentAppPath()` を優先します。

守ること:

- `router.push("/lobby/ROOM1")` のような root 固定文字列を増やさない
- 現在の pathname から mount path を引き継ぐ必要がある遷移は `buildCurrentAppPath()` を通す
- `window.location.pathname` を直接つないで独自実装しない

### 3. API 呼び出しは `buildCurrentApiPath()` を使う

クライアント側の `fetch()` は、mount path 配下でも正しく `/games/prompdojo/play/api/...` を向く必要があります。

守ること:

- クライアント側の API 呼び出しは `buildCurrentApiPath()` 経由で組み立てる
- 既存の `apiPost()` を使える場面ではそちらを優先する
- 外部 origin を明示する必要があるときだけ `NEXT_PUBLIC_APP_ORIGIN` を使う
- `NEXT_PUBLIC_APP_ORIGIN` を省略する場合でも、production では `APP_BASE_URL` が canonical origin になる前提を保つ

### 4. cookie / cross-site 条件を触る変更は慎重に見る

このアプリは cross-site context で配信される可能性があるため、cookie 条件を雑に変えると mount path 側だけ認証が外れることがあります。

守ること:

- session cookie の条件を変えるときは `src/lib/auth/session.ts` を確認する
- `sameSite`, `secure`, `partitioned`, `path` を変更するときは mount path 側のログイン状態も確認する
- 内部 URL や社内 host 名はドキュメントやコードコメントに書かない

## 禁止パターン

次のような実装は避けてください。

- `href="/lobby/ROOM1"` のような root 固定の app path
- `router.push("/round/ROOM1")` のような root 固定の遷移
- `fetch("/api/rooms/create")` のような root 固定の API 呼び出し
- `src="/_next/static/..."` や `href="/_next/static/..."` のような asset 直書き
- `src="/icon.png"` `href="/manifest.webmanifest"` のような public asset の root 固定参照を無批判に増やすこと
- `window.location.origin + "/api/..."` のような雑な URL 組み立て
- mount path を考慮せずに `pathname.split("/")` を個別実装すること

目安:

- app path は `buildCurrentAppPath()`
- API path は `buildCurrentApiPath()`
- asset path は `next.config.ts` の `assetPrefix` に従う
- embedded 配信で asset host が崩れるときは、`APP_BASE_URL` / `ASSET_PREFIX` の設定を疑う

## 修正パターン

### 画面遷移

悪い例:

```ts
router.push(`/lobby/${roomId}`);
```

修正方針:

```ts
router.push(buildCurrentAppPath(`/lobby/${roomId}`));
```

### API 呼び出し

悪い例:

```ts
await fetch("/api/rooms/create", { method: "POST" });
```

修正方針:

```ts
await fetch(buildCurrentApiPath("/api/rooms/create"), { method: "POST" });
```

または既存の `apiPost()` を使います。

### 画像・静的 asset

確認ポイント:

- root 固定の `/...` 参照を新しく追加していないか
- favicon, manifest, OG image, 公開画像の参照が mount path 配下でも成立するか
- `_next` 配下の CSS / JS を root 固定前提で扱っていないか

### 外部 origin

確認ポイント:

- cross-origin API を使う必要がないのに absolute URL を直書きしていないか
- absolute URL が必要なら `NEXT_PUBLIC_APP_ORIGIN` を source of truth にしているか
- `NEXT_PUBLIC_APP_ORIGIN` を未設定で運用する場合は、`APP_BASE_URL` を canonical origin として設定しているか
- current origin と API origin が異なるときの分岐を `src/lib/client/paths.ts` に揃えているか

### cookie / same-site

確認ポイント:

- cookie の `path` が `/` のままか
- production で `sameSite`, `secure`, `partitioned` の条件を崩していないか
- mount path 側だけ 401 になる変更を入れていないか

## 変更時の確認コマンド

最低限、次を実行してください。

```bash
npm run build
npx vitest run src/lib/config/public-origin.test.ts
npx vitest run src/lib/client/paths.test.ts
```

必要に応じて、local でも mount path を直接確認します。

- `/games/prompdojo/play` を直接開く
- 生成 HTML の `link` / `script` が mount path または canonical origin 配下の `_next/...` を向いていることを確認する
- ロビー遷移、ラウンド遷移、API 呼び出しが `/games/prompdojo/play/...` を保ったまま動くことを確認する

## トラブルシュート

### 症状: 黒背景で素のボタンだけ見える

最初に疑うこと:

- CSS / JS asset が mount path を通らず `/_next/...` を向いていないか
- CSS / JS / font asset が埋め込み先 host から読まれて 404 になっていないか
- `next.config.ts` の `assetPrefix` と `rewrites` を壊していないか

確認手順:

- ページ HTML の `link` / `script` を見る
- 404 の Request URL の host を見る
- 埋め込み先 host から `/_next` や font を読んでいたら canonical origin 配信に失敗している
- `next.config.ts` の `PUBLIC_MOUNT_PREFIX`, `assetPrefix`, `APP_BASE_URL`, `ASSET_PREFIX` を見直す

### 症状: 一部画面遷移だけ壊れる

最初に疑うこと:

- `router.push()` / `replace()` / `Link` のどこかに root 固定 path を直書きしていないか

確認手順:

- 追加した遷移コードを検索する
- `buildCurrentAppPath()` を通しているか確認する
- `"/lobby/"`, `"/round/"`, `"/results/"`, `"/transition/"` の直書きを疑う

### 症状: API だけ 404 になる

最初に疑うこと:

- クライアント側 `fetch()` が `/api/...` を root 固定で叩いていないか
- `buildCurrentApiPath()` を通さずに自前で URL を作っていないか

確認手順:

- `fetch(` の呼び出し元を確認する
- `apiPost()` か `buildCurrentApiPath()` を経由しているかを見る

### 症状: API だけ 401 になる

最初に疑うこと:

- cookie 条件を変えたか
- cross-site / embedded context を考慮しない変更が入っていないか

確認手順:

- `src/lib/auth/session.ts` の cookie option を確認する
- `sameSite`, `secure`, `partitioned`, `path` の変更有無を見る

## 変更前チェックリスト

- 新規 route / redirect / push / replace で root 固定 URL を作っていない
- `fetch()` が `buildCurrentApiPath()` 経由か、mount path を壊さない absolute origin になっている
- public asset / icon / OG image / manifest 参照が root 固定でない
- `/_next` 配下の CSS / JS が mount path または canonical origin 経由で配信される前提を壊していない
- cookie / embedded context を触る変更では cross-site 配信条件を再確認している

このチェックで迷ったら、まず `next.config.ts` と `src/lib/client/paths.ts` を見直してください。
