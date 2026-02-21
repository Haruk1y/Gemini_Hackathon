以下は **「Nano Banana（Gemini 2.5 Flash Image）＋Gemini API」前提**で、コーディングエージェントに渡してそのまま実装を進められる粒度の **全体システム設計書（MVP）**です。
（ハッカソン 1 日で “動く・遊べる・審査員に刺さる” を最優先に、拡張ポイントも同梱）

---

# 1. プロダクト概要

## 1.1 ゲームコンセプト（MVP）

**Prompt Mirror Battle（仮）**

* ゲームマスター（AI）が “お題画像” を生成（Nano Banana）
* 参加者はお題画像を見て「再現プロンプト」を書き、画像生成（Nano Banana）
* お題画像と参加者画像を **埋め込み**で比較し、近いほど高得点（勝者）

> Nano Banana は Gemini のネイティブ画像生成（＋編集）で、モデル ID として `gemini-2.5-flash-image`（速度重視）や `gemini-3-pro-image-preview`（高品質）などが用意されています。([Google AI for Developers][1])

## 1.2 画面（固定 3 枚）

* Lobby（ルーム作成／参加／Ready）
* Round（お題表示／プロンプト入力／生成／スコア更新／ヒント）
* Results（ランキング／勝者表示／次ラウンド）

※ UI は別で固めた **Neobrutalism**（太線・ステッカー）を前提に、ここでは **データ同期・API・状態遷移**を中心に設計します。

---

# 2. 採用技術（MVPで最短）

## 2.1 推奨スタック（実装最短ルート）

* **Next.js（App Router） + TypeScript**

  * 3画面をそのまま `app/(routes)` に切る
  * API Routes（Route Handlers）で Gemini 呼び出しと Firestore 更新
* **Firebase**

  * Auth：匿名ログイン（hackathon 向け最短）
  * Firestore：ルーム/ラウンド/スコアのリアルタイム同期
  * Storage：生成画像を保存（URL を Firestore に格納）

## 2.2 Gemini API（Google AI Studio / Gemini API）

* 画像生成・編集：`gemini-2.5-flash-image`（Nano Banana）
  ([Google AI for Developers][1])
* テキスト生成（GMプロンプト作成、画像キャプション、ヒント生成）：`gemini-3-flash-preview`（例としてドキュメントの標準）
  ([Google AI for Developers][2])
* 埋め込み：`gemini-embedding-001` + `embedContent`
  ([Google AI for Developers][3])
* 構造化出力（JSON Schema）：GMプロンプト生成・キャプション生成に **Structured Outputs** を使う
  ([Google AI for Developers][4])

## 2.3 API キー運用（必須）

* **Gemini API キーはサーバ側でのみ保持**（Next.js API routes）
* ブラウザに直接 API キーを置かない（流出リスク）
  ([Google AI for Developers][5])

---

# 3. 全体アーキテクチャ

## 3.1 コンポーネント構成

```
[Browser: Next.js UI]
  - Firebase Auth (anonymous)
  - Firestore realtime listeners (rooms/rounds/scores)
  - Call Next.js API (Bearer Firebase ID Token)

        │ HTTPS (ID token)
        ▼

[Next.js Server (API Routes)]
  - Verify Firebase ID token
  - Gemini API calls (@google/genai)
  - Scoring (caption -> embedding -> cosine)
  - Upload images to Firebase Storage
  - Write to Firestore (Admin SDK)

        ▼
[Firebase]
  - Firestore (realtime state)
  - Storage (images)
```

## 3.2 “リアルタイム” の実現方法

* **同期の主役は Firestore**（onSnapshot）

  * ルーム状態、残り時間、スコアボードをリアルタイム表示
* クライアントからの操作は **全部 API Routes に送る**

  * ＝チート耐性が上がり、Firestore Security Rules も単純になる

---

# 4. 状態遷移（ルーム / ラウンド）

## 4.1 Room status（単一の状態機械）

`rooms/{roomId}.status` を以下で管理：

* `LOBBY`
* `GENERATING_ROUND`（GM 画像生成中）
* `IN_ROUND`（回答受付中）
* `RESULTS`（結果表示）
* `FINISHED`（任意：ゲーム終了）

### 遷移

* LOBBY → GENERATING_ROUND：host が Start を押す
* GENERATING_ROUND → IN_ROUND：GM の画像生成＆埋め込み準備が完了
* IN_ROUND → RESULTS：タイムアップ or host が End
* RESULTS → GENERATING_ROUND：Next Round
* RESULTS → FINISHED：End Game

## 4.2 IN_ROUND の制約（サーバで強制）

* `now < endsAt` のときのみ submit を受け付ける
* `attemptsUsed < maxAttempts` のときのみ画像生成を許可
* `hintUsed < hintLimit` のときのみヒント実行可（MVPは1回）

---

# 5. Firestore データ設計（実装粒度）

> 重要：**GMの秘密（お題プロンプト・ターゲット埋め込み等）**は “公開ドキュメント” と分けます。Firestore はフィールド単位で隠せないため、**doc を分割**します。

## 5.1 コレクションツリー

```
rooms/{roomId}
  players/{uid}
  rounds/{roundId}
  rounds_private/{roundId}        // サーバのみ
  rounds/{roundId}/scores/{uid}   // 公開ランキング
  rounds/{roundId}/attempts_private/{uid} // 本人のみ
```

---

## 5.2 rooms/{roomId}（公開・全員読む）

```ts
type RoomDoc = {
  roomId: string;          // docId と同じでOK
  code: string;            // 参加コード（表示用）
  createdAt: Timestamp;
  createdByUid: string;

  status: "LOBBY" | "GENERATING_ROUND" | "IN_ROUND" | "RESULTS" | "FINISHED";
  currentRoundId: string | null;
  roundIndex: number;      // 1,2,3...

  settings: {
    maxPlayers: number;      // 2..10
    roundSeconds: number;    // 60..120
    maxAttempts: number;     // 1..5（MVPは3）
    aspectRatio: "1:1" | "16:9" | "9:16";
    imageModel: "flash";     // MVP固定（必要なら "pro" を追加）
    hintLimit: number;       // 0..2（MVPは1）
  };

  ui: {
    theme: "neo-brutal";     // MVP固定
  };
};
```

---

## 5.3 rooms/{roomId}/players/{uid}（公開・全員読む）

```ts
type PlayerDoc = {
  uid: string;
  displayName: string;
  isHost: boolean;

  joinedAt: Timestamp;
  lastSeenAt: Timestamp;

  ready: boolean;

  // 合計スコア（複数ラウンド）
  totalScore: number;
};
```

---

## 5.4 rooms/{roomId}/rounds/{roundId}（公開・全員読む）

```ts
type RoundPublicDoc = {
  roundId: string;
  index: number;

  status: "GENERATING" | "IN_ROUND" | "RESULTS";

  startedAt: Timestamp | null;
  endsAt: Timestamp | null;

  // お題画像（公開）
  targetImageUrl: string;   // Storage URL
  targetThumbUrl: string;   // 低解像度があるなら

  // お題の “メタ” は公開してもOK（ゲーム性向上）
  gmTitle: string;          // 例: "Neon Sushi Cat"
  gmTags: string[];         // 例: ["cat","sushi","neon"]
  difficulty: 1 | 2 | 3 | 4 | 5;

  // 結果フェーズで公開してもよい（任意）
  reveal: {
    targetCaption?: string;     // 正解の説明（ネタバレなので RESULTS でのみ）
    gmPromptPublic?: string;    // GMが使ったプロンプト（RESULTSで公開）
  };

  stats: {
    submissions: number;
    topScore: number;
  };
};
```

---

## 5.5 rooms/{roomId}/rounds_private/{roundId}（サーバのみ）

```ts
type RoundPrivateDoc = {
  roundId: string;
  createdAt: Timestamp;

  gmPrompt: string;            // 完全な生成プロンプト（秘密）
  gmNegativePrompt?: string;

  // ターゲット画像の説明（構造化→正規化した文字列）
  targetCaptionJson: any;
  targetCaptionText: string;

  // 埋め込み（スコアリングの基準）
  targetEmbedding: number[];
  targetEmbedModel: "gemini-embedding-001";
  targetEmbedDim: number;      // 例: 3072 など

  // デバッグ・安全用
  safety: {
    blocked: boolean;
    reason?: string;
  };
};
```

---

## 5.6 rooms/{roomId}/rounds/{roundId}/attempts_private/{uid}（本人のみ）

```ts
type AttemptsPrivateDoc = {
  uid: string;
  roundId: string;

  attemptsUsed: number;       // 0..maxAttempts
  hintUsed: number;           // 0..hintLimit

  bestScore: number;          // 0..100
  bestAttemptNo: number | null;

  attempts: Array<{
    attemptNo: number;        // 1..maxAttempts
    prompt: string;

    imageUrl: string;         // Storage URL
    captionText: string;      // 正規化後
    score: number;            // 0..100
    createdAt: Timestamp;
  }>;

  updatedAt: Timestamp;
};
```

---

## 5.7 rooms/{roomId}/rounds/{roundId}/scores/{uid}（公開ランキング）

```ts
type ScoreDoc = {
  uid: string;
  displayName: string;

  bestScore: number;      // 0..100
  bestImageUrl: string;

  // RESULTS で公開したい場合だけ入れる
  bestPromptPublic?: string;

  updatedAt: Timestamp;
};
```

---

# 6. Storage 設計

## 6.1 パス規約

```
/rooms/{roomId}/rounds/{roundId}/target.png
/rooms/{roomId}/rounds/{roundId}/players/{uid}/attempt-{n}.png
/rooms/{roomId}/rounds/{roundId}/players/{uid}/hint.png
```

## 6.2 画像形式

* 生成結果は基本 PNG で統一（UI 表示が安定）
* 画像は `downloadUrl` を Firestore に入れて `<img>` で即表示できるようにする

---

# 7. API 設計（Next.js Route Handlers）

## 共通仕様

* すべて `POST`（副作用あり）
* 認証：`Authorization: Bearer <Firebase ID Token>`
* すべての API で `roomId` と `uid` の整合性を検証
* 返却は JSON（エラー時も JSON）

### 共通エラー形

```json
{
  "ok": false,
  "error": {
    "code": "ROOM_NOT_FOUND | NOT_HOST | ROUND_CLOSED | RATE_LIMIT | GEMINI_ERROR",
    "message": "human readable",
    "retryable": true
  }
}
```

---

## 7.1 Room

### 7.1.1 `POST /api/rooms/create`

**目的**：ホストが新規ルーム作成

Request:

```json
{
  "displayName": "Alice",
  "settings": {
    "maxPlayers": 8,
    "roundSeconds": 90,
    "maxAttempts": 3,
    "aspectRatio": "1:1",
    "hintLimit": 1
  }
}
```

Response:

```json
{
  "ok": true,
  "roomId": "ABCD12",
  "code": "ABCD12"
}
```

Server side effects:

* rooms/{roomId} 作成（status=LOBBY）
* players/{uid} 作成（isHost=true, ready=false）

---

### 7.1.2 `POST /api/rooms/join`

Request:

```json
{
  "code": "ABCD12",
  "displayName": "Bob"
}
```

Response:

```json
{ "ok": true, "roomId": "ABCD12" }
```

Side effects:

* players/{uid} 作成（isHost=false）

Validation:

* status が LOBBY 以外なら join 拒否（MVP仕様）
* maxPlayers 超過拒否

---

### 7.1.3 `POST /api/rooms/ready`

Request:

```json
{ "roomId": "ABCD12", "ready": true }
```

Response:

```json
{ "ok": true }
```

Side effects:

* players/{uid}.ready 更新

---

## 7.2 Round lifecycle

### 7.2.1 `POST /api/rounds/start`

**host only**
Request:

```json
{ "roomId": "ABCD12" }
```

Response:

```json
{ "ok": true, "roundId": "R1" }
```

Side effects（重要：順番）

1. rooms.status = GENERATING_ROUND
2. rounds/{roundId} 作成（status=GENERATING）
3. **GMプロンプト生成（Gemini Text）**
4. **お題画像生成（Nano Banana）**
5. **お題キャプション生成（Gemini Text + image input）**
6. **お題キャプション埋め込み生成（Embedding）**
7. Storageへ target.png 保存、URL取得
8. rounds/{roundId}（公開）に targetImageUrl など書き込み
9. rounds_private/{roundId}（秘密）に gmPrompt/embedding を保存
10. endsAt を設定し、rooms.status=IN_ROUND / rounds.status=IN_ROUND

> 画像生成は `gemini-2.5-flash-image` を `generateContent` で呼び、返ってくる `inlineData`（base64）を保存します。([Google AI for Developers][1])
> テキスト生成（GMプロンプト等）の基本呼び出しは `@google/genai` の `generateContent` で、モデル例として `gemini-3-flash-preview` がドキュメントに載っています。([Google AI for Developers][2])
> 埋め込みは `embedContent` + `gemini-embedding-001` を使います。([Google AI for Developers][3])

---

### 7.2.2 `POST /api/rounds/submit`

**目的**：プレイヤーのプロンプトから画像生成→採点

Request:

```json
{
  "roomId": "ABCD12",
  "roundId": "R1",
  "prompt": "A neon cat eating sushi, 3D sticker style, bold outlines..."
}
```

Response:

```json
{
  "ok": true,
  "attemptNo": 2,
  "score": 73,
  "imageUrl": "https://...",
  "bestScore": 81
}
```

Server processing steps:

1. ルーム/ラウンド検証（status=IN_ROUND、now < endsAt）
2. attempts_private/{uid} 読み込み（なければ作る）
3. attemptsUsed < maxAttempts を確認
4. **画像生成（Nano Banana）**
5. Storage に attempt-{n}.png 保存 → imageUrl
6. **画像キャプション生成（Gemini Text + image input、Structured output 推奨）**
7. **キャプション埋め込み生成（Embedding）**
8. cosine 類似度で 0..100 に変換
9. attempts_private に attempts 追記、best 更新
10. scores/{uid} を upsert（best が更新された時だけ bestImageUrl を差し替え）
11. rounds.stats.topScore を必要なら更新（トランザクション）

---

### 7.2.3 `POST /api/rounds/endIfNeeded`

**目的**：ホスト不在でもタイムアップで確実に結果に遷移させる（冪等）

Request:

```json
{ "roomId": "ABCD12", "roundId": "R1" }
```

Response:

```json
{ "ok": true, "status": "RESULTS" }
```

Logic:

* if now >= endsAt and rooms.status==IN_ROUND → rooms.status=RESULTS / rounds.status=RESULTS
* それ以外は no-op で ok:true を返す（冪等）

---

### 7.2.4 `POST /api/rounds/next`

**host only**
Request:

```json
{ "roomId": "ABCD12" }
```

Side effects:

* 次ラウンドを start と同様に作る（roundIndex++）

---

## 7.3 Hint / Edit（ハッカソン映え要素）

### 7.3.1 `POST /api/rounds/hint`

**目的**：AI が改善案を出し、さらに “編集” でヒント画像を提示

Request:

```json
{
  "roomId": "ABCD12",
  "roundId": "R1"
}
```

Response:

```json
{
  "ok": true,
  "hint": {
    "deltaChecklist": [
      "背景に '夜の屋台' 要素を追加",
      "猫の表情を 'ドヤ顔' に寄せる",
      "寿司を 'サーモン握り' に固定"
    ],
    "improvedPrompt": "..."
  },
  "hintImageUrl": "https://..."
}
```

Steps:

1. hintUsed < hintLimit
2. サーバが `targetCaptionText` と「直近の attempt（caption/prompt）」を入力にして
   **改善プロンプト案（Structured output）**を生成
3. **画像編集（Nano Banana の image+prompt）**で “改善後イメージ” を生成して保存

   * 「あなたの画像をベースに、差分だけ直す」挙動を狙う
4. hintUsed++ を記録

> Nano Banana は “画像を入力して編集指示” のような会話的な生成・編集が可能です（プロンプト＋画像入力）。([Google AI for Developers][1])

---

# 8. Gemini 呼び出し詳細（実装用）

## 8.1 SDK

* Node/TS: `@google/genai`（ドキュメント例に合わせる）([Google AI for Developers][2])

### 初期化（サーバのみ）

* 環境変数：`GEMINI_API_KEY`
* API キーは “サーバ側で保持” が推奨（クライアント露出禁止）([Google AI for Developers][5])

---

## 8.2 Structured outputs（GMプロンプト/キャプションで必須）

Gemini は JSON Schema に合わせた構造化出力が可能で、JS では Zod→JSON Schema 変換が例示されています。([Google AI for Developers][4])

### 8.2.1 GM Prompt Schema（例）

```ts
// Zodイメージ（実装は zodToJsonSchema を使用）
GM = {
  title: string,
  difficulty: 1|2|3|4|5,
  tags: string[],
  prompt: string,
  negativePrompt?: string,
  mustInclude: string[],
  mustAvoid: string[]
}
```

GM生成プロンプト（System/Developer の雰囲気、実装向けに固定）：

* 画像生成しやすい具体性（被写体、背景、構図、色、質感、光）
* テキストや著名キャラ、ロゴは避ける（生成失敗/審査リスク回避）
* Neo-brutal / sticker っぽい “太線・ポップ” をお題側にも寄せる（体験統一）

---

## 8.3 Image generation（Nano Banana）

* モデル：`gemini-2.5-flash-image`（MVP固定）([Google AI for Developers][1])
* `responseModalities: ["Image"]` を指定できる（REST例もあり）([Google AI for Developers][1])
* アスペクト比：`imageConfig.aspectRatio` で制御できる([Google AI for Developers][1])

---

## 8.4 Caption（画像→構造化説明）

* モデル：`gemini-3-flash-preview`（画像入力可）([Google AI for Developers][2])
* Structured outputs で JSON を返させる([Google AI for Developers][4])

### Caption Schema（例）

```ts
Caption = {
  scene: string,                 // 何が起きてるか 1文
  mainSubjects: string[],        // 主役
  keyObjects: string[],          // 重要小物
  colors: string[],              // 主要色
  style: string,                 // 例: "neo-brutal sticker, bold outline"
  composition: string,           // 例: "centered, close-up"
  textInImage: string | null     // 画像内テキスト（あれば）
}
```

### 正規化（embeddingに入れるための “固定文字列化”）

`targetCaptionText` / `playerCaptionText` は以下ルールで同一化：

* 全フィールドを一定順序で連結
* 配列はアルファベット順ソート
* 小文字化（必要なら）
* 余計な空白や改行削除

---

## 8.5 Embedding（テキスト→ベクトル）

* モデル：`gemini-embedding-001`
* メソッド：`embedContent`([Google AI for Developers][3])
* 複数 texts を配列で一括 embedding できる（効率化に使える）([Google AI for Developers][3])

---

## 8.6 Similarity → Score

* cosine similarity `sim = dot(a,b) / (||a||*||b||)`
* MVP は 0..100 に線形マップで OK：

  * `score = round( clamp(sim, 0, 1) * 100 )`
* 端末表示用に

  * 0–39: “Cold”
  * 40–69: “Warm”
  * 70–89: “Hot”
  * 90–100: “Perfect”

---

# 9. マルチプレイ同期（クライアント実装指示）

## 9.1 Lobby ページが subscribe するもの

* `rooms/{roomId}`（status, settings）
* `rooms/{roomId}/players`（一覧・ready）
* UI: 全員 ready && host が Start 押せる

## 9.2 Round ページが subscribe するもの

* `rooms/{roomId}`（status, currentRoundId）
* `rooms/{roomId}/rounds/{roundId}`（targetImageUrl, endsAt, stats）
* `rooms/{roomId}/rounds/{roundId}/scores`（ランキング）
* `rooms/{roomId}/rounds/{roundId}/attempts_private/{myUid}`（自分の履歴）

Round UI の動き：

* status==IN_ROUND：入力可
* endsAt の countdown で 0 になったら `endIfNeeded` を呼ぶ（全員が呼んでも冪等）

## 9.3 Results ページが subscribe するもの

* `rooms/{roomId}`（status）
* `rounds/{roundId}`（reveal, targetImageUrl）
* `scores`（最終ランキング）
* 自分の attempts_private（自分のベストと比較）

---

# 10. セキュリティ・チート対策（MVP最小）

## 10.1 基本方針

* クライアントは **Firestore 書き込み禁止**
* すべて API routes 経由で状態変更（サーバが検証）

## 10.2 Firestore Security Rules（方針）

* read: `request.auth != null`
* write: `false`（Admin SDK 経由のみ）

※ `attempts_private` を本人だけ読ませたい場合は例外を追加してもよいが、MVPでは「全部 read 許可」でも致命ではない（ただしプロンプト覗き見問題が出る）。
**おすすめは “attempts_private を本人のみ read 可”**。

## 10.3 API キー保護

* Gemini API キーはサーバ側で保持し、クライアントに渡さない([Google AI for Developers][5])

---

# 11. コスト制御 / 安定運用（ハッカソン現実解）

## 11.1 呼び出し回数制限（強制）

* 1 round / 1 player：

  * submit（画像生成）最大 `maxAttempts`（MVP 3）
  * hint 最大 1
* 1 room：

  * maxPlayers 8 程度に制限

## 11.2 リトライ戦略（429/一時失敗）

* Gemini API が `RESOURCE_EXHAUSTED` 等の場合：

  * 250ms → 750ms → 1500ms（ジッター込み）で最大 3 回
* それでもだめなら「混雑中」エラーを返し、UI でリトライボタン

## 11.3 生成サイズ固定

* MVPは `aspectRatio=1:1`, `imageModel=flash` 固定でコストを読めるようにする
  （Nano Banana は aspect ratio 指定が可能）([Google AI for Developers][1])

---

# 12. “Google AI スイート活用”の盛り込み（MVP + 拡張）

ハッカソンのステートメントに合わせ、MVPに **確実に入る**ものと、**時間があれば刺さる**ものを分けます。

## 12.1 MVPで確実に入れる（本設計の中核）

* Nano Banana（画像生成・編集）([Google AI for Developers][1])
* Structured outputs（GM/Caption/Hint を JSON 化）([Google AI for Developers][4])
* Embeddings（gemini-embedding-001）([Google AI for Developers][3])
* マルチプレイ（Firestore realtime）

## 12.2 Stretch（“映え”の追加：Live API）

* **AI実況（音声）**：Round中に “今のトップは誰” “あと10秒” を喋る
* Live API は低遅延の音声/動画/テキストストリーミングを想定した API ([Google AI for Developers][6])
* クライアント直結するなら **Ephemeral tokens** を使う（Live APIのみ対応）([Google AI for Developers][7])

### 実装最小の設計（Stretch）

* `POST /api/live/token`：サーバが ephemeral token を発行して返す（1分以内に接続開始が必要等の制約あり）([Google AI for Developers][7])
* フロント：WebSocket で Live API に接続し、テキストイベント（score更新等）を送って音声を受ける

## 12.3 Stretch（“映え”の追加：Computer Use）

* **AI がプレイヤーのプロンプト欄を “操作” して改善案を入力してくる**
* Computer Use はスクショを見て click/type 等の UI アクションを提案し、クライアント側でそれを実行するループを実装する仕組み([Google AI for Developers][8])

※ これは 1日だと重いので、**デモ用に “1ターンだけ（type_text_at だけ）”**に絞るのが現実的。

---

# 13. リポジトリ構成（コーディングエージェント向け）

## 13.1 フォルダ

```
/app
  /(routes)
    /lobby/[roomId]/page.tsx
    /round/[roomId]/page.tsx
    /results/[roomId]/page.tsx
/api
  /rooms/create/route.ts
  /rooms/join/route.ts
  /rooms/ready/route.ts
  /rounds/start/route.ts
  /rounds/submit/route.ts
  /rounds/endIfNeeded/route.ts
  /rounds/hint/route.ts
  /rounds/next/route.ts
/lib
  /auth/verifyIdToken.ts
  /firebase/admin.ts
  /firebase/client.ts
  /firebase/schema.ts
  /storage/uploadPng.ts
  /gemini/client.ts
  /gemini/schemas.ts          // zod schemas (GM, Caption, Hint)
  /gemini/prompts.ts          // prompt templates
  /scoring/cosine.ts
  /scoring/normalizeCaption.ts
  /utils/time.ts
  /utils/errors.ts
```

## 13.2 依存パッケージ（例）

* firebase, firebase-admin
* @google/genai
* zod, zod-to-json-schema
* nanoid（roomId生成）
* p-limit（Gemini呼び出し同時数制御）
* sharp（必要なら base64→png 正規化）

---

# 14. 実装順序（1日で終わらせる段取り）

1. Firebase Auth（匿名） + Firestore read 接続 + 3画面ルーティング
2. rooms/create + join + ready（Lobby が動く）
3. rounds/start（GM生成→target表示→IN_ROUNDへ）
4. rounds/submit（画像生成→表示→score反映→ランキング更新）
5. results 画面（score一覧・勝者表示）
6. hint（改善案テキストだけ）→余裕あれば hintImage（編集）
7. （余裕あれば）Live API 実況 / Computer Use のデモ

---

必要なら、この設計書をベースに **「そのままコピペで使える Zod schema / prompt テンプレ / API route の雛形（TypeScript）」**まで落として、実装開始点をさらに前倒しできます。

[1]: https://ai.google.dev/gemini-api/docs/image-generation "Nano Banana image generation  |  Gemini API  |  Google AI for Developers"
[2]: https://ai.google.dev/gemini-api/docs/text-generation "Text generation  |  Gemini API  |  Google AI for Developers"
[3]: https://ai.google.dev/gemini-api/docs/embeddings "Embeddings  |  Gemini API  |  Google AI for Developers"
[4]: https://ai.google.dev/gemini-api/docs/structured-output "Structured outputs  |  Gemini API  |  Google AI for Developers"
[5]: https://ai.google.dev/gemini-api/docs/api-key "Using Gemini API keys  |  Google AI for Developers"
[6]: https://ai.google.dev/gemini-api/docs/live "Get started with Live API  |  Gemini API  |  Google AI for Developers"
[7]: https://ai.google.dev/gemini-api/docs/ephemeral-tokens "Ephemeral tokens  |  Gemini API  |  Google AI for Developers"
[8]: https://ai.google.dev/gemini-api/docs/computer-use "Computer Use  |  Gemini API  |  Google AI for Developers"
