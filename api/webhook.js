async function handleEvent(event) {
  if (event.type !== 'message') return;

  console.log('handleEvent start, type:', event.message.type);

  const user = {
    name: 'テストユーザー',
    goal: '減量',
    calorieTarget: 1800,
    proteinTarget: 120,
  };

  let replyText = '';

  if (event.message.type === 'text') {
    const text = event.message.text;
    console.log('text received:', text);
    console.log('isMealReport:', isMealReport(text));

    const userPrompt = isMealReport(text)
      ? `会員情報: 目標=${user.goal}, カロリー目標=${user.calorieTarget}kcal, タンパク質目標=${user.proteinTarget}g\n\n食事内容: ${text}\n\nPFCとカロリーを推定してアドバイスをください。フォーマット:\n【解析結果】\n・カロリー：約〇〇kcal\n・P:〇g / F:〇g / C:〇g\n【アドバイス】（1〜2文）`
      : `会員の質問: ${text}\n栄養に関する質問に200文字以内で答えてください。`;

    console.log('Calling Claude API...');
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    console.log('Claude response received');
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

  if (!replyText) {
    console.log('replyText is empty, skipping reply');
    return;
  }

  console.log('Sending reply...');
  await lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  });
  console.log('Reply sent successfully');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok' });
  }

  console.log('Webhook received. Events:', JSON.stringify(req.body.events));

  res.status(200).json({ ok: true });

  await Promise.all((req.body.events || []).map(handleEvent)).catch((err) => {
    console.error('handleEvent error:', err.message, err.stack);
  });
};
