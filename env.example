const fs = require('fs');
const path = require('path');

const systemPrompt = fs.readFileSync(
  path.join(__dirname, 'system.txt'), 'utf-8'
);

function buildTextMealPrompt(user, mealText, todayTotal) {
  return `
## 会員情報
名前: ${user.name}
目標: ${user.goal}（目標体重: ${user.targetWeight}kg）
アレルギー: ${user.allergies || 'なし'}
カロリー目標: ${user.calorieTarget}kcal/日 / タンパク質目標: ${user.proteinTarget}g/日

## 今日の累計（この食事の前）
カロリー: ${todayTotal.calories}kcal
タンパク質: ${todayTotal.protein}g / 脂質: ${todayTotal.fat}g / 炭水化物: ${todayTotal.carbs}g

## 今回の食事（会員の入力）
${mealText}

## 出力フォーマット（必ずこの形式で）
【解析結果】
・カロリー：約〇〇kcal（推定）
・P: 〇g / F: 〇g / C: 〇g

【今日の残り目標】
・カロリー: あと〇〇kcal
・タンパク質: あと〇g

【アドバイス】（1〜2文、具体的に）
`;
}

function buildImageMealPrompt(user) {
  return `
## 会員情報
名前: ${user.name} / 目標: ${user.goal}
カロリー目標: ${user.calorieTarget}kcal / タンパク質目標: ${user.proteinTarget}g

## タスク
上の画像の食事を分析してください。

## 出力フォーマット
【料理名】（不明な場合は推定で）
【解析結果】
・カロリー：約〇〇kcal（推定）
・P: 〇g / F: 〇g / C: 〇g

【${user.goal}目標へのアドバイス】（具体的に1〜2文）

※量が判断できない場合は「一般的な1人前」として推定すること
`;
}

function buildWeeklySummaryPrompt(user, weeklyStats) {
  return `
## 会員情報
名前: ${user.name} / 目標: ${user.goal} / 目標体重: ${user.targetWeight}kg
日次カロリー目標: ${user.calorieTarget}kcal / 日次タンパク質目標: ${user.proteinTarget}g

## 先週の記録集計（${weeklyStats.startDate}〜${weeklyStats.endDate}）
記録日数: ${weeklyStats.recordedDays}/7日
平均カロリー: ${weeklyStats.avgCalories}kcal
平均タンパク質: ${weeklyStats.avgProtein}g / 平均脂質: ${weeklyStats.avgFat}g / 平均炭水化物: ${weeklyStats.avgCarbs}g
よく食べた料理TOP3: ${weeklyStats.topMeals.join('、')}

## 出力フォーマット
先週の食事サマリー（${weeklyStats.startDate}〜）

【数値結果】
・平均カロリー: 〇〇kcal（目標比: ±〇〇kcal）
・タンパク質: 〇g → [達成/未達]
・脂質: 〇g → [良好/高め/低め]
・記録率: 〇/7日

【今週の重点ポイント】（具体的な行動提案を1つ）

【ひとこと応援】（20文字以内で前向きに）
`;
}

function buildFaqPrompt(user, question) {
  return `
## 会員情報
名前: ${user.name} / 目標: ${user.goal}

## 質問
${question}

## 回答の指針
- 会員の目標（${user.goal}）に関連する内容なら、それを踏まえてパーソナライズする
- 科学的根拠に基づいて答える
- 200文字以内で簡潔に
- 必要なら「詳しくはトレーナーにご相談ください」と添える
`;
}

module.exports = {
  systemPrompt,
  buildTextMealPrompt,
  buildImageMealPrompt,
  buildWeeklySummaryPrompt,
  buildFaqPrompt,
};
