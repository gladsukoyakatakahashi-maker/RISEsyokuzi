# RISEGYM 食事管理LINEボット

## セットアップ

```bash
npm install
cp .env.example .env
# .envに各APIキーを設定
npm run dev
```

## ファイル構成

```
src/
├── index.js              # Expressサーバー・エントリポイント
├── handlers/
│   └── lineWebhook.js    # LINEイベントハンドラ
├── utils/
│   └── claude.js         # Claude API呼び出し関数
└── prompts/
    ├── system.txt        # システムプロンプト（全リクエスト共通）
    └── index.js          # プロンプトビルダー関数群
```

## Phase 別の拡張ポイント

### Phase 1（現在）
- テキスト・画像の食事解析
- ダミーユーザーでの動作確認

### Phase 2（次のステップ）
- `src/utils/db.js` を追加してFirestore接続
- `lineWebhook.js` のダミーユーザー部分をDB取得に差し替え
- 初回ヒアリングフロー（`handlers/onboarding.js`）を追加

### Phase 3
- 週次バッチ（`src/jobs/weeklySummary.js`）を追加
- トレーナー管理画面（別リポジトリ推奨）
