const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const systemPrompt = `あなたはパーソナルジム「RISEGYM」の食事管理AIアシスタントです。
会員の食事内容を分析し、PFC（タンパク質・脂質・炭水化物）とカロリーを推定してフィードバックしてください。
トーンは親しみやすく励ます口調で、200文字以内で簡潔に返答してください。
数値は具体的に伝え、否定より代替案を提示してください。`;

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MEAL_PATTERNS = [
  /食べた|食べました|食べる|飲んだ|飲みました/,
  /^(朝|昼|夕|夜|間食)\s*[:：]/,
  /定食|弁当|ランチ|ディナー|朝食|昼食|夕食/,
];

function isMealReport(text) {
  return MEAL_PATTERNS.some((re) => re.test(text));
}

async function handleEvent(event) {
  if (event.type !== 'message') return;

  const user = {
    name: 'テストユーザー',
    goal: '減量',
    calorieTarget: 1800,
    proteinTarget: 120,
  };

  let replyText = '';

  if (event.message.type === 'text') {
    const text = event.message.text;
    const userPrompt = isMealReport(text)
      ? `会員情報: 目標=${user.goal}, カロリー目標=${user.calorieTarget}kcal, タンパク質目標=${user.proteinTarget}g\n\n食事内容: ${text}\n\nPFCとカロリーを推定してアドバイスをください。フォーマット:\n【解析結果】\n・カロリー：約〇〇kcal\n・P:〇g / F:〇g / C:〇g\n【アドバイス】（1〜2文）`
      : `会員の質問: ${text}\n栄養に関する質問に200文字以内で答えてください。`;

    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    replyText = res.content[0].text;

  } else if (event.message.type === 'image') {
    const imageContent = await lineClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of imageContent) chunks.push(chunk);
    const imageBase64 = Buffer.concat(chunks).toString('base64');

    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `目標: ${user.goal}。この食事のPFCとカロリーを推定してアドバイスをください。\n【料理名】\n【解析結果】\n・カロリー：約〇〇kcal\n・P:〇g / F:〇g / C:〇g\n【アドバイス】（1〜2文）` },
        ],
      }],
    });
    replyText = res.content[0].text;
  }

  if (!replyText) return;

  await lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok' });
  }

  // 署名検証を一時スキップ（テスト用）
  console.log('Webhook received. Events:', JSON.stringify(req.body.events));

  res.status(200).json({ ok: true });

  await Promise.all((req.body.events || []).map(handleEvent)).catch((err) => {
    console.error('handleEvent error:', err);
  });
};
