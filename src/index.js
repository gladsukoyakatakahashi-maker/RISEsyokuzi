const express = require('express');
const line = require('@line/bot-sdk');
const { handleLineEvent } = require('./handlers/lineWebhook');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

app.post('/webhook',
  line.middleware(lineConfig),
  async (req, res) => {
    res.status(200).json({ ok: true });
    await Promise.all(req.body.events.map(handleLineEvent)).catch(console.error);
  }
);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('RISEGYM Bot listening on port ' + PORT));
