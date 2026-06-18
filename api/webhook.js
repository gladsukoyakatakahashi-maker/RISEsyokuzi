const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const GAS_URL = process.env.GAS_URL;

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

function getToday() {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return `${jst.getFullYear()}/${jst.getMonth() + 1}/${jst.getDate()}`;
}

function getLastWeekDates() {
  const dates = [];
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const dayOfWeek = jst.getDay();
  const lastMonday = new Date(jst);
  lastMonday.setDate(jst.getDate() - dayOfWeek - 6);
  for (let i = 0; i < 7; i++) {
    const d = new Date(lastMonday);
    d.setDate(lastMonday.getDate() + i);
    dates.push(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
  }
  return dates;
}

// アイソカロリー計算式でTDEEと各栄養素目標を計算
function calculateTargets(weight, height, age, gender, activityLevel, goal) {
  // 基礎代謝（Mifflin-St Jeor式）
  let bmr;
  if (gender === '男性') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  // 活動係数
  const activityMap = {
    '低い（座り仕事中心）': 1.2,
    '普通（週1〜3回運動）': 1.375,
    '高い（週4〜5回運動）': 1.55,
    '非常に高い（毎日運動）': 1.725,
  };
  const activityFactor = activityMap[activityLevel] || 1.375;
  const tdee = Math.round(bmr * activityFactor);

  // 目標別カロリー調整
  let calorieTarget;
  if (goal === '減量') calorieTarget = Math.round(tdee - 500);
  else if (goal === '増量') calorieTarget = Math.round(tdee + 500);
  else calorieTarget = tdee;

  // PFC計算
  // タンパク質：体重×2g（減量・ボディメイク）、体重×2.2g（増量）
  const proteinMultiplier = goal === '増量' ? 2.2 : 2.0;
  const proteinTarget = Math.round(weight * proteinMultiplier);

  // 脂質：カロリーの25%
  const fatTarget = Math.round((calorieTarget * 0.25) / 9);

  // 炭水化物：残りカロリーから計算
  const proteinCalories = proteinTarget * 4;
  const fatCalories = fatTarget * 9;
  const carbsTarget = Math.round((calorieTarget - proteinCalories - fatCalories) / 4);

  return { calorieTarget, proteinTarget, fatTarget, carbsTarget };
}

async function callGAS(action, params = {}) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
      redirect: 'follow',
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch (err) {
    console.error('callGAS error:', err.message);
    return null;
  }
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
  const users = await callGAS('getAllUsers');
  const dates = getLastWeekDates();
  const startDate = dates[0];
  const endDate = dates[6];
  let successCount = 0;

  for (const user of users) {
    try {
      const summary = await callGAS('getWeeklySummary', { userId: user.userId, dates });
      if (summary.recordedDays === 0) continue;

      const avgCalories = Math.round(summary.totalCalories / summary.recordedDays);
      const avgProtein = Math.round(summary.totalProtein / summary.recordedDays);
      const calorieDiff = avgCalories - user.calorieTarget;
      const proteinStatus = avgProtein >= user.proteinTarget ? '達成✅' : '未達⚠️';
      const advice = await generateWeeklyAdvice(summary, user);

      const message = `先週の食事サマリー（${startDate}〜${endDate}）\n\n【数値結果】\n・平均カロリー：${avgCalories}kcal（目標比：${calorieDiff >= 0 ? '+' : ''}${calorieDiff}kcal）\n・タンパク質：${avgProtein}g → ${proteinStatus}\n・記録日数：${summary.recordedDays}/7日\n\n【今週の重点ポイント】\n${advice.point}\n\n【ひとこと応援】\n${advice.cheer}`;

      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          to: user.userId,
          messages: [{ type: 'text', text: message }],
        }),
      });
      successCount++;
    } catch (err) {
      console.error(`Error for ${user.userId}:`, err.message);
    }
  }
  return successCount;
}

async function handleEvent(event) {
  const userId = event.source.userId;

  if (event.type === 'follow') {
    await callGAS('saveProfile', { userId, profile: { step: 'ask_goal' } });
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

  const profileData = await callGAS('getProfile', { userId });

  // 初回ヒアリング：目標選択
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
    await callGAS('saveProfile', { userId, profile: { step: 'ask_gender', goal } });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `「${goal}」ですね！💪\n\n性別を教えてください。\n\n1️⃣ 男性\n2️⃣ 女性` }]
    });
    return;
  }

  // 初回ヒアリング：性別
  if (profileData.step === 'ask_gender') {
    const text = event.message.text || '';
    let gender = null;
    if (text.includes('1') || text.includes('男')) gender = '男性';
    else if (text.includes('2') || text.includes('女')) gender = '女性';

    if (!gender) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '1（男性）か2（女性）でお答えください😊' }]
      });
      return;
    }
    await callGAS('saveProfile', { userId, profile: { step: 'ask_age', gender } });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `「${gender}」ですね！\n\n年齢を教えてください。\n（例：25）` }]
    });
    return;
  }

  // 初回ヒアリング：年齢
  if (profileData.step === 'ask_age') {
    const age = parseInt(event.message.text);
    if (isNaN(age) || age < 10 || age > 100) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '年齢を数字で入力してください。\n（例：25）' }]
      });
      return;
    }
    await callGAS('saveProfile', { userId, profile: { step: 'ask_height', age } });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `${age}歳ですね！\n\n身長を教えてください。\n（例：170）` }]
    });
    return;
  }

  // 初回ヒアリング：身長
  if (profileData.step === 'ask_height') {
    const height = parseFloat(event.message.text);
    if (isNaN(height) || height < 100 || height > 250) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '身長を数字で入力してください。\n（例：170）' }]
      });
      return;
    }
    await callGAS('saveProfile', { userId, profile: { step: 'ask_weight', height } });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `${height}cmですね！\n\n現在の体重を教えてください。\n（例：68）` }]
    });
    return;
  }

  // 初回ヒアリング：体重
  if (profileData.step === 'ask_weight') {
    const weight = parseFloat(event.message.text);
    if (isNaN(weight) || weight < 30 || weight > 200) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '体重を数字で入力してください。\n（例：68）' }]
      });
      return;
    }
    await callGAS('saveProfile', { userId, profile: { step: 'ask_activity', weight } });
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `${weight}kgですね！\n\n普段の運動レベルを教えてください。\n\n1️⃣ 低い（座り仕事中心）\n2️⃣ 普通（週1〜3回運動）\n3️⃣ 高い（週4〜5回運動）\n4️⃣ 非常に高い（毎日運動）` }]
    });
    return;
  }

  // 初回ヒアリング：運動レベル
  if (profileData.step === 'ask_activity') {
    const text = event.message.text || '';
    let activityLevel = null;
    if (text.includes('1') || text.includes('低い')) activityLevel = '低い（座り仕事中心）';
    else if (text.includes('2') || text.includes('普通')) activityLevel = '普通（週1〜3回運動）';
    else if (text.includes('3') || text.includes('高い')) activityLevel = '高い（週4〜5回運動）';
    else if (text.includes('4') || text.includes('非常')) activityLevel = '非常に高い（毎日運動）';

    if (!activityLevel) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '1〜4の番号でお答えください😊' }]
      });
      return;
    }

    // 全データが揃ったので目標値を計算
    const targets = calculateTargets(
      profileData.weight,
      profileData.height,
      profileData.age,
      profileData.gender,
      activityLevel,
      profileData.goal
    );

    const completed = {
      step: 'done',
      activityLevel,
      ...targets,
    };
    await callGAS('saveProfile', { userId, profile: completed });

    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: `登録完了です🎉\n\n【あなたのプロフィール】\n・目標：${profileData.goal}\n・性別：${profileData.gender}\n・年齢：${profileData.age}歳\n・身長：${profileData.height}cm\n・体重：${profileData.weight}kg\n・運動レベル：${activityLevel}\n\n【1日の目標】\n・カロリー：${targets.calorieTarget}kcal\n・タンパク質：${targets.proteinTarget}g\n・脂質：${targets.fatTarget}g\n・炭水化物：${targets.carbsTarget}g\n\n食事内容をテキストや写真で送ってください！`
      }]
    });
    return;
  }

  // 通常の食事解析
  const user = profileData;
  const fatTarget = user.fatTarget || 50;
  const carbsTarget = user.carbsTarget || 180;
  let replyText = '';

  if (event.message.type === 'text') {
    const text = event.message.text;

    if (isMealReport(text)) {
      const meal = await analyzeMeal(text, user.goal);
      if (meal) {
        const today = getToday();
        const todayTotal = await callGAS('updateTodayTotal', { userId, date: today, meal });
        const remainCalories = user.calorieTarget - todayTotal.calories;
        const remainProtein = user.proteinTarget - todayTotal.protein;
        const remainFat = fatTarget - todayTotal.fat;
        const remainCarbs = carbsTarget - todayTotal.carbs;
        replyText = `【解析結果】\n・カロリー：約${meal.calories}kcal\n・P:${meal.protein}g / F:${meal.fat}g / C:${meal.carbs}g\n\n【今日の残り目標】\n・カロリー：あと${Math.max(0, remainCalories)}kcal\n・タンパク質：あと${Math.max(0, remainProtein)}g\n・脂質：あと${Math.max(0, remainFat)}g\n・炭水化物：あと${Math.max(0, remainCarbs)}g\n\n【アドバイス】\n${meal.advice}`;
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
      const today = getToday();
      const todayTotal = await callGAS('updateTodayTotal', { userId, date: today, meal });
      const remainCalories = user.calorieTarget - todayTotal.calories;
      const remainProtein = user.proteinTarget - todayTotal.protein;
      const remainFat = fatTarget - todayTotal.fat;
      const remainCarbs = carbsTarget - todayTotal.carbs;
      replyText = `【料理名】\n${meal.dish}\n\n【解析結果】\n・カロリー：約${meal.calories}kcal\n・P:${meal.protein}g / F:${meal.fat}g / C:${meal.carbs}g\n\n【今日の残り目標】\n・カロリー：あと${Math.max(0, remainCalories)}kcal\n・タンパク質：あと${Math.max(0, remainProtein)}g\n・脂質：あと${Math.max(0, remainFat)}g\n・炭水化物：あと${Math.max(0, remainCarbs)}g\n\n【アドバイス】\n${meal.advice}`;
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
