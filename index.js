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

  if (userMessage.includes('請求書') || userMessage.includes('領収書')) {
    await handleInvoice(event, userMessage);
  } else {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `「請求書」または「領収書」と入力すると作成します！\n\n例：請求書 株式会社〇〇 50000円 コンサルティング料` }]
    });
  }
}

async function handleInvoice(event, userMessage) {
  try {
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

    // HTMLで請求書を作成
    const html = generateInvoiceHTML(invoiceData);

    // PDFを生成
    const pdfBuffer = await generatePDF(html);

    // Google Driveにアップロード
const fileName = `請求書_${invoiceData.clientName}_${Date.now()}.pdf`;
const driveUrl = await uploadToDrive(pdfBuffer, fileName);

await client.replyMessage({
  replyToken: event.replyToken,
  messages: [{
    type: 'text',
    text: `✅ ${invoiceData.type}を作成しました！\n\n📋 宛先：${invoiceData.clientName}\n💰 金額：¥${invoiceData.amount}\n📝 内容：${invoiceData.item}\n📅 日付：${invoiceData.date}\n\n📄 PDFはこちら：\n${driveUrl}`
  }]
});

  } catch (error) {
    console.error(error);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'エラーが発生しました。もう一度お試しください。' }]
    });
  }
}

function generateInvoiceHTML(data) {
  return `
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Noto Sans JP', sans-serif; padding: 40px; color: #333; }
  h1 { text-align: center; font-size: 28px; margin-bottom: 30px; }
  .info { margin-bottom: 20px; }
  .info table { width: 100%; border-collapse: collapse; }
  .info td { padding: 10px; border: 1px solid #ddd; }
  .amount { font-size: 24px; font-weight: bold; text-align: right; margin: 20px 0; }
  .footer { margin-top: 40px; text-align: right; }
</style>
</head>
<body>
  <h1>${data.type}</h1>
  <div class="info">
    <table>
      <tr><td>宛先</td><td>${data.client_name} 御中</td></tr>
      <tr><td>日付</td><td>${data.date}</td></tr>
      <tr><td>内容</td><td>${data.description}</td></tr>
    </table>
  </div>
  <div class="amount">金額：¥${data.amount.toLocaleString()}-（税込）</div>
  <div class="footer">
    <p>発行者：バックオフィス テストbot</p>
  </div>
</body>
</html>`;
}

async function generatePDF(data) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const { height } = page.getSize();
  let y = height - 50;

  const lines = [
    'Invoice',
    '',
    `Client: ${data.clientName || ''}`,
    `Date: ${data.date || ''}`,
    '',
    `Item: ${data.item || ''}`,
    `Amount: ${data.amount || ''}`,
    '',
    `Total: ${data.total || ''}`,
  ];

  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 14, font, color: rgb(0, 0, 0) });
    y -= 25;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
async function uploadToDrive(pdfBuffer, fileName) {
  const { google } = require('googleapis');

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/pdf',
    },
    media: {
      mimeType: 'application/pdf',
      body: require('stream').Readable.from(pdfBuffer),
    },
    fields: 'id',
  });

  const fileId = response.data.id;
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}

 const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動中: ポート${PORT}`);
});
