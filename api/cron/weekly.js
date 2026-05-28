const { Redis } = require('@upstash/redis');
const Anthropic = require('@anthropic-ai/sdk');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 先週の日付リスト（月〜日）を返す
function getLastWeekDates() {
  const dates = [];
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=日, 1=月
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - dayOfWeek - 6);

  for (let i = 0; i < 7; i++) {
    const d = new Date(lastMonday);
    d.setDate(lastMonday.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// 全会員のユーザーIDを取得
async function getAllUserIds() {
  const keys = await redis.keys('profile:*');
  return keys.map((k) => k.replace('profile:', ''));
}

// 先週の食事データを集計
async function getWeeklySummary(userId) {
  const dates = getLastWeekDates();
  let totalCalories = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  let recordedDays = 0;

  for (const date of dates) {
    const key = `meal:${userId}:${date}`;
    const data = await redis.get(key);
    if (data) {
      const meal = typeof data === 'string' ? JSON.parse(data) : data;
      totalCalories += meal.calories || 0;
      totalProtein += meal.protein || 0;
      totalFat += meal.fat || 0;
      totalCarbs += meal.carbs || 0;
      recordedDays++;
    }
  }

  return { totalCalories, totalProtein, totalFat, totalCarbs, recordedDays, days: 7 };
}

// Claudeでアドバイス生成
async function generateAdvice(summary, profile) {
  const avgCalories = summary.recordedDays > 0
    ? Math.round(summary.totalCalories / summary.recordedDays)
    : 0;
  const avgProtein = summary.recordedDays > 0
    ? Math.round(summary.totalProtein / summary.recordedDays)
    : 0;

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

// LINEにメッセージ送信
async function sendLineMessage(userId, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  });
  return res.ok;
}

module.exports = async (req, res) => {
  // Cronからのリクエストか確認
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dates = getLastWeekDates();
  const startDate = dates[0].slice(5).replace('-', '/');
  const endDate = dates[6].slice(5).replace('-', '/');

  const userIds = await getAllUserIds();
  let successCount = 0;

  for (const userId of userIds) {
    try {
      const profileRaw = await redis.get(`profile:${userId}`);
      if (!profileRaw) continue;

      const profile = typeof profileRaw === 'string' ? JSON.parse(profileRaw) : profileRaw;
      if (profile.step !== 'done') continue;

      const summary = await getWeeklySummary(userId);
      if (summary.recordedDays === 0) continue;

      const avgCalories = Math.round(summary.totalCalories / summary.recordedDays);
      const avgProtein = Math.round(summary.totalProtein / summary.recordedDays);
      const calorieDiff = avgCalories - profile.calorieTarget;
      const proteinStatus = avgProtein >= profile.proteinTarget ? '達成✅' : '未達⚠️';

      const advice = await generateAdvice(summary, profile);

      const message = `先週の食事サマリー（${startDate}〜${endDate}）\n\n【数値結果】\n・平均カロリー：${avgCalories}kcal（目標比：${calorieDiff >= 0 ? '+' : ''}${calorieDiff}kcal）\n・タンパク質：${avgProtein}g → ${proteinStatus}\n・記録日数：${summary.recordedDays}/7日\n\n【今週の重点ポイント】\n${advice.point}\n\n【ひとこと応援】\n${advice.cheer}`;

      await sendLineMessage(userId, message);
      successCount++;
    } catch (err) {
      console.error(`Error for ${userId}:`, err.message);
    }
  }

  res.status(200).json({ ok: true, sent: successCount });
};
