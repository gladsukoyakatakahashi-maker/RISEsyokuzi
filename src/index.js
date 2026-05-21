const express = require('express');
const line = require('@line/bot-sdk');
const { handleLineEvent } = require('./handlers/lineWebhook');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

// LINE署名検証 + Webhookエンドポイント
// line.middleware() が req.body をパースするため、このルートより前に
// express.json() を呼ばないこと（競合してしまう）
app.post(
  '/webhook',
  line.middleware(lineConfig),
  async (req, res) => {
    // LINEサーバーへ即座に200を返す（タイムアウト防止）
    res.status(200).json({ ok: true });
    // イベントを並列処理
    await Promise.all(req.body.events.map(handleLineEvent)).catch(console.error);
  }
);

// ヘルスチェック（Vercel / Cloud Run の死活監視用）
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('RISEGYM Bot listening on port ' + PORT);
});
