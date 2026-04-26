require('dotenv/config');
const express = require('express');
const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => {
  res.send('サーバー起動中です！');
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.json({ status: 'ok' });
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text;

  // 請求書コマンドの判定
  if (userMessage.includes('請求書') || userMessage.includes('領収書')) {
    await handleInvoice(event, userMessage);
  } else {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `「請求書」または「領収書」と入力すると請求書を作成します！\n\n例：請求書 株式会社〇〇 50000円 コンサルティング料` }]
    });
  }
}

async function handleInvoice(event, userMessage) {
  try {
    // Claudeで内容を解析
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `以下のメッセージから請求書情報をJSON形式で抽出してください。

メッセージ: ${userMessage}

以下のJSON形式のみで返してください：
{
  "type": "請求書" または "領収書",
  "client_name": "クライアント名",
  "amount": 金額(数字のみ),
  "description": "内容",
  "date": "今日の日付(YYYY年MM月DD日形式)"
}`
      }]
    });

    const jsonText = response.content[0].text.replace(/```json|```/g, '').trim();
    const invoiceData = JSON.parse(jsonText);

    const replyText = `✅ ${invoiceData.type}を作成しました！\n\n` +
      `📋 宛先：${invoiceData.client_name}\n` +
      `💰 金額：¥${invoiceData.amount.toLocaleString()}\n` +
      `📝 内容：${invoiceData.description}\n` +
      `📅 日付：${invoiceData.date}\n\n` +
      `※PDF生成機能は次のステップで追加します！`;

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }]
    });

  } catch (error) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'エラーが発生しました。もう一度お試しください。' }]
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動中: ポート${PORT}`);
});