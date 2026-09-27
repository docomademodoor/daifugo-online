# Daifugo Online

ブラウザ上で遊べる大富豪オンライン対戦アプリです。

## 概要

- Node.js + Express + Socket.IO を使ったリアルタイム対戦
- 2人以上でルームを作成して対戦可能
- ルール選択により、ローカルルールを調整可能
- スマホでも1画面で見やすいレイアウトを採用
- Render 上で簡単に公開可能

## 必要環境

- Node.js 20 以上
- npm

## ローカル開発

```bash
npm install
npm run dev
```

ブラウザで以下を開いて遊べます。

```text
http://localhost:3000
```

## 本番起動

```bash
npm install
npm start
```

## 本番デプロイ

このリポジトリには Render 用の設定ファイルが含まれています。

- `render.yaml`

Render で新規 Web Service を作成し、GitHub リポジトリを接続すると自動デプロイされます。

### デプロイ手順

1. GitHub にこのリポジトリを push
2. Render にログイン
3. New + Web Service を選択
4. GitHub リポジトリを接続
5. `render.yaml` を検出して設定を適用
6. Deploy を実行

## テスト

```bash
npm test -- --run
```

## ルール構成

- 8切り
- 革命
- マーク縛り
- スペ3返し
- 階段
- 階段革命
- Jバック
- 連番縛り
- 5飛び
- 7渡し
- 10捨て
- ♢3スタート
- 都落ち
- 禁止上がり
- ジョーカー込み

## 開発メモ

- クライアントは `public/` 配下に配置
- サーバーは `src/server.js` と `src/game/` 配下に配置
- ゲームロジックの回帰防止のため Vitest によるテストを実装済み

## ライセンス

本プロジェクトは学習用途・開発用途を想定しています。
