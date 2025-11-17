# Discord ChatGPT Bot

ChatGPT API（OpenAI API）を使った Discord ボットです。  
メンションや DM で話しかけると ChatGPT が返信してくれるほか、

- 会話の履歴 ON/OFF 切り替え
- URL の本文取得 ＋ 要約（function calling）
- モデル切り替え（gpt-4o / gpt-4o-mini / o3-mini / o1-mini）
- トークン使用量の集計・リセット

などの機能を備えています。

このボットは **OpenAI API の従量課金制（トークン課金）** で動作します。  
利用状況に応じて OpenAI 側の料金が発生するため、APIキーの管理や `/usage_token` コマンドでのトークン確認を推奨します。

---

## 動作環境・必要なもの

- Node.js 18 以上（推奨）
- npm
- インターネット接続
- Discord アカウント
- Discord Bot トークン  
  └ Discord Developer Portal でアプリケーション＋Botを作成して取得
- OpenAI API キー  
  └ OpenAI のダッシュボードから発行（従量課金制）
---

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

※ コード内で `node-fetch@2` を使用しています。
`package.json` に含まれていない場合は以下も実行してください。

```bash
npm install node-fetch@2
```

---

### 2. Discord Bot の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. 「Bot」タブで Bot を作成し、トークンを取得
3. 「Privileged Gateway Intents」で以下を有効化

   * MESSAGE CONTENT INTENT
4. 「OAuth2 → URL Generator」で以下を選択して招待 URL を生成

   * Scopes: `bot`, `applications.commands`
   * Bot Permissions: `Send Messages`, `Read Message History` など
5. 招待 URL から Bot をサーバーに参加させる

---

### 3. OpenAI API キーの準備

[OpenAI の管理画面](https://platform.openai.com/)から API キーを取得します。

---

### 4. 環境変数の設定

プロジェクトルートに `.env` ファイルを作成し、以下を設定します。

```env
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
```

---

## 起動方法

```bash
npm start
```

または（`package.json` に scripts がない場合）：

```bash
node index.js
```

起動に成功するとコンソールに以下のようなログが出ます。

```txt
ログイン成功: ○○○#1234
全コマンド登録完了
```

---

## Bot の基本的な動き

### 1. 反応する条件

* **サーバー内**
  → Bot にメンションされたメッセージにのみ反応します。
  例：

  ```txt
  @Bot こんにちは！
  ```

* **DM（ダイレクトメッセージ）**
  → DM ではメンションなしでそのまま話しかければ反応します。

---

### 2. モデル・履歴の設定単位

設定は以下の単位で管理されます。

* サーバー内：**ギルドごと**
* DM：**ユーザーごと**

内部的には `settings.json` に保存されます。

```json
{
  "guild_id_or_DM_user_id": {
    "model": "gpt-4o-mini",
    "history": true
  }
}
```

---

## 実装されているスラッシュコマンド

### `/model`

使用する AI モデルを切り替えます（ギルド / DM 単位）。

```txt
/model name: gpt-4o-mini（速い・軽い）
```

選べるモデル：

* `gpt-4o-mini（速い・軽い）`
* `gpt-4o（高品質）`
* `o3-mini（推論強い）`
* `o1-mini（コード向き）`

※ 内部的には `value`（モデル名）が API に送られます。

---

### `/history`

会話の履歴参照を ON/OFF します。

* `on`：直近のやり取り（最大10メッセージ）を毎回 API に送り、**会話の流れを踏まえて回答**します。
* `off`：履歴を送らず、**毎回そのメッセージだけで回答**します。

例：

```txt
/history mode: on
/history mode: off
```

---

### `/reset`

現在のギルド / DM に対応する **会話履歴を削除** します。
「さっきの話は忘れてほしい」ときに使用します。

---

### `/history_status`

Bot が現在「そのギルド / DM」で覚えている会話履歴の一覧を確認できます。

* `user` / `assistant` ごとに
* 先頭 100 文字まで
* 長過ぎる場合は途中で省略

---

### `/usage_token`

Bot 起動後に消費した **トークンの累計** を確認します。

表示される内容：

* 総トークン数 `total_tokens`
* プロンプトトークン数 `prompt_tokens`
* 生成トークン数 `completion_tokens`

※ これは Bot 全体の統計です（ギルド/DM問わず合算）。

---

### `/reset_token`

`/usage_token` で集計しているトークン統計（`tokenStats`）をリセットします。

* `total_tokens`
* `prompt_tokens`
* `completion_tokens`

がすべて 0 に戻ります。

---

## URL 要約機能（function calling）

この Bot には **URL を貼ると中身を取得・要約してくれる機能** が入っています。

### 使い方（例）

```txt
@Bot このURLの内容をざっくり要約して
https://example.com/some-article
```

内部の流れ：

1. OpenAI に対して `fetch_url` というツール（function）を定義しておく
2. モデルが「URLの中身が必要だ」と判断した場合、`fetch_url` を呼び出すようなレスポンスを返す
3. Bot 側で `fetch_url_content(url)` を実行し、HTML を取得 → テキスト抽出
4. 抽出したテキストを再度モデルに渡し、「要約して」と依頼
5. 要約結果を Discord に返信

※ HTML → テキスト変換は簡易的なものなので、ページの構造によって精度は変わります。

---

## トークン使用量のログ

OpenAI API の呼び出しごとに、コンソールログにトークン使用量が出力されます。

```txt
使用トークン(1st): 123
使用トークン(2nd): 456
```

* URL 関連の function-calling を行った場合は
  1回目（function 呼び出しまで）と 2回目（本文を渡して最終回答）の2回分が表示されます。
* 通常の回答のみの場合は 1st のログだけが出ます。

`tokenStats` にも合計値が積算されるため、`/usage_token` でいつでも確認できます。

---

## 会話履歴について

* 会話履歴はメモリ上の `conversationHistory` で管理しています。
* キー：ギルド ID または `DM_ユーザーID`
* 値：`[{ role: "user" | "assistant", content: string }]` の配列
* 最大直近 10 件だけをコンテキストとして API に渡しています。

Bot を再起動すると `conversationHistory` はリセットされます（永続化はしていません）。

---

## 開発・カスタマイズのヒント

* `index.js` 内の `fetch_url_content()` を差し替えることで、
  Twitter / YouTube / RSS など専用のパーサーに置き換えることも可能です。
* function calling の `tools` 定義を増やせば、
  「サーバー情報を返す関数」「DB を読む関数」など、Bot に色々な能力を追加できます。
* 履歴の永続化をしたい場合は、`conversationHistory` をファイルや DB（SQLite 等）に保存する処理を追加してください。

---

## 注意・トラブルシューティング

- API を叩いても ChatGPT から回答が返らず、`insufficient_quota` などのエラーが発生する場合は、  
  OpenAI アカウント側でクレジットカードの登録や請求先情報の設定が完了していない可能性があります。  
  OpenAI のダッシュボードで利用状況や課金設定を確認してください。
  