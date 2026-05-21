/**
 * src/jobs/weeklySummary.js
 * Phase 3 で有効化する週次バッチ。
 * Cloud Scheduler から POST /jobs/weekly-summary を叩くことで起動。
 *
 * スケジュール設定例（Cloud Scheduler）:
 *   Cron: 0 8 * * 1  （毎週月曜 8:00 JST）
 *   Target: https://your-app.run.app/jobs/weekly-summary
 *   HTTP method: POST
 *   Auth: OIDC token
 */

const line = require('@line/bot-sdk');
const { getUser, getWeeklyStats } = require('../utils/db');
const { generateWeeklySummary } = require('../utils/claude');
const { buildWeeklySummaryPrompt } = require('../prompts');

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

/**
 * 全アクティブ会員に週次サマリーを送信する
 * @param {string[]} userIds - 送信対象のLINE userIdリスト
 */
async function runWeeklySummaryJob(userIds) {
  // 日付範囲を計算（先週月曜〜日曜）
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=日, 1=月
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - dayOfWeek - 6);
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - dayOfWeek);

  const startDate = lastMonday.toISOString().slice(0, 10);
  const endDate   = lastSunday.toISOString().slice(0, 10);

  console.log(`[weeklySummary] ${startDate} 〜 ${endDate} / 対象 ${userIds.length}名`);

  const results = await Promise.allSettled(
    userIds.map((userId) => sendSummaryToUser(userId, startDate, endDate))
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed    = results.filter((r) => r.status === 'rejected').length;
  console.log(`[weeklySummary] 完了 — 成功: ${succeeded} / 失敗: ${failed}`);
}

async function sendSummaryToUser(userId, startDate, endDate) {
  const [user, weeklyStats] = await Promise.all([
    getUser(userId),
    getWeeklyStats(userId, startDate, endDate),
  ]);

  if (!user) {
    console.warn(`[weeklySummary] ユーザーが見つかりません: ${userId}`);
    return;
  }

  // 記録が1日もない場合はスキップ（継続促進メッセージを別途送る構成も可）
  if (weeklyStats.recordedDays === 0) {
    console.log(`[weeklySummary] 記録なしのためスキップ: ${userId}`);
    return;
  }

  const prompt  = buildWeeklySummaryPrompt(user, weeklyStats);
  const summary = await generateWeeklySummary(prompt);

  // Phase 3 本番: トレーナー管理画面の「承認待ちキュー」に追加し、
  //              承認後にLINE送信する構成が理想。
  //              MVP段階では直接送信でもOK。
  await lineClient.pushMessage({
    to: userId,
    messages: [{ type: 'text', text: summary }],
  });

  console.log(`[weeklySummary] 送信完了: ${user.name}`);
}

module.exports = { runWeeklySummaryJob };
