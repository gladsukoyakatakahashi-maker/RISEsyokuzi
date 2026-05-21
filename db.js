const line = require('@line/bot-sdk');
const { analyzeTextMeal, analyzeImageMeal, answerFaq } = require('../utils/claude');
const {
  buildTextMealPrompt,
  buildImageMealPrompt,
  buildFaqPrompt,
} = require('../prompts');
// Phase 2で有効化: const db = require('../utils/db');

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// ---- 入力種別の判定 ----
// 「〜食べた」「朝:〜」「昼飯〜」などを食事報告、それ以外をFAQとみなす
const MEAL_PATTERNS = [
  /食べた|食べました|食べる|飲んだ|飲みました/,
  /^(朝|昼|夕|夜|間食)\s*[:：]/,
  /定食|弁当|ランチ|ディナー|朝食|昼食|夕食/,
];

function isMealReport(text) {
  return MEAL_PATTERNS.some((re) => re.test(text));
}

// ---- クイックリプライボタン ----
const QUICK_REPLIES_AFTER_MEAL = {
  type: 'text',
  text: '続けて記録する',
  quickReply: {
    items: [
      { type: 'action', action: { type: 'message', label: '夕食も記録', text: '夕食を記録します' } },
      { type: 'action', action: { type: 'message', label: '今日の合計を見る', text: '今日の食事合計を教えて' } },
      { type: 'action', action: { type: 'message', label: '栄養の質問', text: '栄養について質問があります' } },
    ],
  },
};

// ---- メインハンドラ ----
async function handleLineEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;

  // Phase 2: Firestoreから取得
  // const user = await db.getUser(userId);
  // const todayTotal = await db.getTodayTotal(userId);

  // Phase 1: ダミーユーザー（実装確認用）
  const user = {
    name: 'テストユーザー',
    goal: '減量',
    targetWeight: 60,
    calorieTarget: 1800,
    proteinTarget: 120,
    allergies: 'なし',
  };
  const todayTotal = { calories: 600, protein: 40, fat: 20, carbs: 80 };

  let replyMessages = [];

  // テキストメッセージ
  if (event.message.type === 'text') {
    const text = event.message.text;

    if (isMealReport(text)) {
      // 食事報告
      const prompt = buildTextMealPrompt(user, text, todayTotal);
      const analysis = await analyzeTextMeal(prompt);

      // Phase 2: DBに保存
      // await db.saveMeal(userId, { text, analysis, timestamp: new Date() });

      replyMessages = [
        { type: 'text', text: analysis },
        QUICK_REPLIES_AFTER_MEAL,
      ];
    } else {
      // FAQ・栄養質問
      const prompt = buildFaqPrompt(user, text);
      const answer = await answerFaq(prompt);
      replyMessages = [{ type: 'text', text: answer }];
    }

  // 画像メッセージ（食事写真）
  } else if (event.message.type === 'image') {
    // LINEサーバーから画像を取得してbase64に変換
    const imageContent = await lineClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of imageContent) chunks.push(chunk);
    const imageBase64 = Buffer.concat(chunks).toString('base64');

    const textPrompt = buildImageMealPrompt(user);
    const analysis = await analyzeImageMeal(imageBase64, textPrompt);

    // Phase 2: DBに保存
    // await db.saveMeal(userId, { imageBase64, analysis, timestamp: new Date() });

    replyMessages = [
      { type: 'text', text: analysis },
      QUICK_REPLIES_AFTER_MEAL,
    ];
  }

  if (replyMessages.length === 0) return;

  await lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: replyMessages,
  });
}

module.exports = { handleLineEvent };
