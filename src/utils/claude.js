const Anthropic = require('@anthropic-ai/sdk');
const { systemPrompt } = require('../prompts');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * テキスト食事解析
 * @param {string} userPrompt - buildTextMealPrompt で生成したプロンプト
 */
async function analyzeTextMeal(userPrompt) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return res.content[0].text;
}

/**
 * 食事画像解析（マルチモーダル）
 * @param {string} imageBase64 - base64エンコードされたJPEG画像
 * @param {string} textPrompt  - buildImageMealPrompt で生成したプロンプト
 */
async function analyzeImageMeal(imageBase64, textPrompt) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
        },
        { type: 'text', text: textPrompt },
      ],
    }],
  });
  return res.content[0].text;
}

/**
 * 週次サマリー生成
 * @param {string} summaryPrompt - buildWeeklySummaryPrompt で生成したプロンプト
 */
async function generateWeeklySummary(summaryPrompt) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: summaryPrompt }],
  });
  return res.content[0].text;
}

/**
 * FAQ・栄養質問への回答
 * @param {string} faqPrompt - buildFaqPrompt で生成したプロンプト
 */
async function answerFaq(faqPrompt) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: faqPrompt }],
  });
  return res.content[0].text;
}

module.exports = { analyzeTextMeal, analyzeImageMeal, generateWeeklySummary, answerFaq };
