# ベースは LTS の Node.js
FROM node:18-slim

# コンテナ内の作業ディレクトリ
WORKDIR /app

# 依存関係だけ先にコピー
COPY package.json package-lock.json ./

# 依存関係をインストール
RUN npm ci --omit=dev

# アプリ本体をコピー
COPY . .

# node ユーザーがファイルにアクセスできるように権限を変更
RUN chown -R node:node /app

# セキュリティ的に root を避けるため node ユーザーを使う (node イメージには標準で node ユーザーがいる)
USER node

# 起動コマンド（package.json の "start" と同じ）
CMD ["npm", "start"]