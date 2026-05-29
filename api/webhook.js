const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const systemPrompt = `あなたはパーソナルジム「RISEGYM」の食事管理AIアシスタントです。
会員の食事内容を分析し、PFC（タンパク質・脂質・炭水化物）とカロリーを推定してフィードバックしてください。
トーンは親しみやすく励ます口調で、200文字以内で簡潔に返答してください。
数値は具体的に伝え、否定より代替案を提示してください。`;

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const lineBlobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MEAL_PATTERNS = [
  /食べた|食べました|食べる|飲んだ|飲みました/,
  /^(朝|昼|夕|夜|間食)\s*[:：]/,
  /定食|弁当|ランチ|ディナー|朝食|昼食|夕食/,
  /ご飯|ごはん|パン|麺|うどん|そば|ラーメン|パスタ|丼|寿司|焼き肉|カレー|サラダ|スープ|卵|肉|魚|野菜/,
];

function isMealReport(text) {
  return MEAL_PATTERNS.some((re) => re.test(text));
}

function todayKey(userId) {
  const today = new Date().toISOString().slice(0, 10);
  return `meal:${userId}:${today}`;
}

function getLastWeekDates() {
  const dates = [];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - dayOfWeek - 6);
  for (let i = 0; i < 7; i++) {
    const d = new Date(lastMonday);
    d.setDate(lastMonday.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function getProfile(userId) {
  const profile = await redis.get(`profile:${userId}`);
  return profile;
}

async function saveProfile(userId, data) {
  await redis.set(`profile:${userId}`, JSON.stringify(data));
}

async function getTodayTotal(userId) {
  const data = await redis.get(todayKey(userId));
  return data ? (typeof data === 'string' ? JSON.parse(data) : data) : { calories: 0, protein: 0, fat: 0, carbs: 0 };
}

async function updateTodayTotal(userId, meal) {
  const current = await getTodayTotal(userId);
  const updated = {
    calories: current.calories + (meal.calories || 0),
    protein: current.protein + (meal.protein || 0),
    fat: current.fat + (meal.fat || 0),
    carbs: current.carbs + (meal.carbs || 0),
  };
  await redis.set(todayKey(userId), JSON.stringify(updated), { ex: 86400 });
  return updated;
}

async function analyzeMeal(text, goal) {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 600,
    system: `あなたは食事のPFCを推定するアシスタントです。必ずJSON形式のみで返答してください。説明文は不要です。`,
    messages: [{
      role: 'user',
      content: `食事内容: ${text}\n\n以下のJSON形式のみで返答してください（マークダウン不要、他のテキスト不要）:\n{"calories":数値,"protein":数値,"fat":数値,"carbs":数値,"advice":"アドバイス文（100文字以内）"}`
    }],
  });
  try {
    const raw = res.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getWeeklySummary(userId) {
  const dates = getLastWeekDates();
  let totalCalories = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0, recordedDays = 0;
  for (const date of dates) {
    const data = await redis.get(`meal:${userId}:${date}`);
    if (data) {
      const meal = typeof data === 'string' ? JSON.parse(data) : data;
      totalCalories += meal.calories || 0;
      totalProtein += meal.protein || 0;
      totalFat += meal.fat || 0;
      totalCarbs += meal.carbs || 0;
      recordedDays++;
    }
  }
  return { totalCalories, totalProtein, totalFat, totalCarbs, recordedDays };
}

async function generateWeeklyAdvice(summary, profile) {
  const avgCalories = summary.recordedDays > 0 ? Math.round(summary.totalCalories / summary.recordedDays) : 0;
  const avgProtein = summary.recordedDays > 0 ? Math.round(summary.totalProtein / summary.recordedDays) : 0;
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `会員情報: 目標=${profile.goal}, カロリー目標=${profile.calorieTarget}kcal, タンパク質目標=${profile.proteinTarget}g\n先週の平均: カロリー=${avgCalories}kcal, タンパク質=${avgProtein}g, 記録日数=${summary.recordedDays}/7日\n\n今週の重点ポイントを1文（50文字以内）と、ひとこと応援メッセージ（20文字以内）をJSON形式で返してください:\n{"point":"重点ポイント","cheer":"応援メッセージ"}`
    }],
  });
  try {
    const raw = res.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return { point: '食事記録を継続しましょう！', cheer: 'この調子で💪' };
  }
}

async function sendWeeklySummaryToAll() {
  const keys = await redis.keys('profile:*');
  const userIds = keys.map((k) => k.replace('profile:', ''));
  const dates = getLastWeekDates();
  const startDate = dates[0].slice(5).replace('-', '/');
  const endDate = dates[6].slice(5).replace('-', '/');
  let successCount = 0;

  for (const uid of userIds) {
    try {
      const profileRaw = await redis.get(`profile:${uid}`);
      if (!profileRaw) continue;
      const profile = typeof profileRaw === 'string' ? JSON.parse(profileRaw) : profileRaw;
      if (profile.step !== 'done') continue;

      const summary = await getWeeklySummary(uid);
      if (summary.recordedDays === 0) continue;

      const avgCalories = Math.round(summary.totalCalories / summary.recordedDays);
      const avgProtein = Math.round(summary.totalProtein / summary.recordedDays);
      const calorieDiff = avgCalories - profile.calorieTarget;
      const proteinStatus = avgProtein >= profile.proteinTarget ? '達成✅' : '未達⚠️';
      const advice = await generateWeeklyAdvice(summary, profile);

      const message = `先週の食事サマリー（${startDate}〜${endDate}）\n\n【数値結果】\n・平均カロリー：${avgCalories}kcal（目標比：${calorieDiff >= 0 ? '+' : ''}${calorieDiff}kcal）\n・タンパク質：${avgProtein}g → ${proteinStatus}\n・記録日数：${summary.recordedDays}/7日\n\n【今週の重点ポイント】\n${advice.point}\n\n【ひとこと応援】\n${advice.cheer}`;

      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          to: uid,
          messages: [{ type: 'text', text: message }],
        }),
      });
      successCount++;
    } catch (err) {
      console.error(`Error for ${uid}:`, err.message);
    }
  }
  return successCount;
}

async function handleEvent(event) {
  const userId = event.source.userId;

  if (event.type === 'follow') {
    await saveProfile(userId, { step: 'ask_goal' });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: 'はじめまして！RISEGYM食事管理ボットです🏋️\n\nまずあなたの目標を教えてください。\n\n1️⃣ 減量\n2️⃣ 増量\n3️⃣ ボディメイク'
      }]
    });
    return;
  }

  if (event.type !== 'message') return;

  if (event.message.type === 'text' && event.message.text === 'サマリー送信') {
    if (userId !== process.env.TRAINER_LINE_ID) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: 'この操作は許可されていません。' }]
      });
      return;
    }
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '週次サマリーを送信中です...⏳' }]
    });
    const count = await sendWeeklySummaryToAll();
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text: `✅ 送信完了！${count}名に週次サマリーを送りました。` }],
      }),
    });
    return;
  }

  const profile = await getProfile(userId);
  const profileData = profile ? (typeof profile === 'string' ? JSON.parse(profile) : profile) : null;

  if (!profileData || profileData.step === 'ask_goal') {
    const text = event.message.text || '';
    let goal = null;
    if (text.includes('1') || text.includes('減量')) goal = '減量';
    else if (text.includes('2') || text.includes('増量')) goal = '増量';
    else if (text.includes('3') || text.includes('ボディメイク')) goal = 'ボディメイク';

    if (!goal) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '1・2・3の番号か、「減量」「増量」「ボディメイク」でお答えください😊' }]
      });
      return;
    }
    await saveProfile(userId, { step: 'ask_weight', goal });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `「${goal}」ですね！💪\n\n次に現在の体重を教えてください。\n（例：68）` }]
    });
    return;
  }

  if (profileData.step === 'ask_weight') {
    const weight = parseFloat(event.message.text);
    if (isNaN(weight) || weight < 30 || weight > 200) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '体重を数字で入力してください。\n（例：68）' }]
      });
      return;
    }
    const calorieMap = { '減量': 1800, '増量': 2800, 'ボディメイク': 2200 };
    const proteinMap = { '減量': 120, '増量': 160, 'ボディメイク': 140 };
    const completed = {
      step: 'done',
      goal: profileData.goal,
      weight,
      calorieTarget: calorieMap[profileData.goal],
      proteinTarget: proteinMap[profileData.goal],
    };
    await saveProfile(userId, completed);
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `登録完了です🎉\n\n【あなたの目標】\n・目標：${completed.goal}\n・体重：${weight}kg\n・カロリー目標：${completed.calorieTarget}kcal/日\n・タンパク質目標：${completed.proteinTarget}g/日\n\n食事内容をテキストや写真で送ってください！`
      }]
    });
    return;
  }

  const user = profileData;
  let replyText = '';

  if (event.message.type === 'text') {
    const text = event.message.text;

    if (isMealReport(text)) {
      const meal = await analyzeMeal(text, user.goal);
      if (meal) {
        const todayTotal = await updateTodayTotal(userId, meal);
        const remainCalories = user.calorieTarget - todayTotal.calories;
        const remainProtein = user.proteinTarget - todayTotal.protein;
        replyText = `【解析結果】\n・カロリー：約${meal.calories}kcal\n・P:${meal.protein}g / F:${meal.fat}g / C:${meal.carbs}g\n\n【今日の残り目標】\n・カロリー：あと${Math.max(0, remainCalories)}kcal\n・タンパク質：あと${Math.max(0, remainProtein)}g\n\n【アドバイス】\n${meal.advice}`;
      } else {
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: 'user', content: `食事内容: ${text}\nPFCとカロリーを推定してアドバイスをください。` }],
        });
        replyText = res.content[0].text;
      }
    } else {
      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: `会員の質問: ${text}\n栄養に関する質問に200文字以内で答えてください。` }],
      });
      replyText = res.content[0].text;
    }

  } else if (event.message.type === 'image') {
    const imageContent = await lineBlobClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of imageContent) chunks.push(Buffer.from(chunk));
    const imageBase64 = Buffer.concat(chunks).toString('base64');

    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: `あなたは食事のPFCを推定するアシスタントです。必ずJSON形式のみで返答してください。説明文は不要です。`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `目標: ${user.goal}。この食事のPFCとカロリーを推定してください。\n以下のJSON形式のみで返答してください（マークダウン不要）:\n{"dish":"料理名","calories":数値,"protein":数値,"fat":数値,"carbs":数値,"advice":"アドバイス文（100文字以内）"}` },
        ],
      }],
    });

    try {
      const raw = res.content[0].text.replace(/```json|```/g, '').trim();
      const meal = JSON.parse(raw);
      const todayTotal = await updateTodayTotal(userId, meal);
      const remainCalories = user.calorieTarget - todayTotal.calories;
      const remainProtein = user.proteinTarget - todayTotal.protein;
      replyText = `【料理名】\n${meal.dish}\n\n【解析結果】\n・カロリー：約${meal.calories}kcal\n・P:${meal.protein}g / F:${meal.fat}g / C:${meal.carbs}g\n\n【今日の残り目標】\n・カロリー：あと${Math.max(0, remainCalories)}kcal\n・タンパク質：あと${Math.max(0, remainProtein)}g\n\n【アドバイス】\n${meal.advice}`;
    } catch {
      replyText = '画像を解析できませんでした。別の角度から撮り直してみてください。';
    }
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

  const signature = req.headers['x-line-signature'];
  const bodyStr = JSON.stringify(req.body);

  if (!line.validateSignature(bodyStr, lineConfig.channelSecret, signature)) {
    console.error('Invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  await Promise.all((req.body.events || []).map(handleEvent)).catch((err) => {
    console.error('Error:', err.message);
  });

  res.status(200).json({ ok: true });
};
