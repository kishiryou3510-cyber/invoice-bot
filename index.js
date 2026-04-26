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
  "client_name": "宛先会社名",
  "description": "件名・内容",
  "amount": 金額(数字のみ),
  "quantity": "数量(数字のみ)",
  "date": "今日の日付(YYYY年MM月DD日形式)",
  "invoice_no": "請求番号(YYYYMMDD-001形式)",
  "issuer_name": "",
  "issuer_zip": "",
  "issuer_address": "",
  "issuer_tel": "",
  "issuer_email": "",
  "bank_info": ""
}`
      }]
    });

    const jsonText = response.content[0].text.replace(/```json|```/g, '').trim();
    const invoiceData = JSON.parse(jsonText);


    // PDFを生成
    const pdfBuffer = await generatePDF(invoiceData);

    // Google Driveにアップロード
const fileName = `請求書_${invoiceData.client_name}_${Date.now()}.pdf`;
const driveUrl = await uploadToDrive(pdfBuffer, fileName);

await client.replyMessage({
  replyToken: event.replyToken,
  messages: [{
    type: 'text',
    text: `✅ ${invoiceData.type}を作成しました！\n\n📋 宛先：${invoiceData.client_name}\n💰 金額：¥${parseInt(invoiceData.amount).toLocaleString()}\n📝 内容：${invoiceData.description}\n📅 日付：${invoiceData.date}\n\n📄 PDFはこちら：\n${driveUrl}`
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
  const PDFDocument = require('pdfkit');
  const chunks = [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const font = 'Helvetica';
    const W = 515;

    // 右上：日付・請求番号
    const today = data.date || '　';
    const invoiceNo = data.invoice_no || '　';
    doc.fontSize(10).font(font)
      .text(today, 0, 40, { align: 'right', width: 595 - 40 })
      .text(`請求番号: ${invoiceNo}`, 0, 55, { align: 'right', width: 595 - 40 });

    // タイトル
    doc.fontSize(22).font(font)
      .text('請求書', 40, 80, { align: 'center', width: W });

    // 宛先（左）
    doc.fontSize(14).font(font)
      .text(`${data.client_name || '　'} 様`, 40, 130);
    doc.moveTo(40, 148).lineTo(280, 148).stroke();

    // 件名
    doc.fontSize(10)
      .text(`件名：${data.description || '　'}`, 40, 158)
      .text('下記のとおりご請求申し上げます。', 40, 175);

    // ご請求金額
    doc.fontSize(10).text('ご請求金額', 40, 200);
    doc.moveTo(40, 212).lineTo(280, 212).stroke();
    const amount = parseInt(data.amount) || 0;
    doc.fontSize(16).text(`¥ ${amount.toLocaleString()} -`, 150, 195);

    // 発行者情報（右）
    doc.fontSize(10)
      .text(data.issuer_name || '　', 310, 130)
      .text(data.issuer_zip || '　', 310, 145)
      .text(data.issuer_address || '　', 310, 160)
      .text(data.issuer_tel || '　', 310, 185)
      .text(data.issuer_email || '　', 310, 200);

    // 明細テーブル
    const tableTop = 230;
    const colX = [40, 320, 390, 460];
    const colW = [280, 70, 70, 75];

    // ヘッダー
    doc.rect(40, tableTop, W, 20).fillAndStroke('#e0e0e0', '#999');
    doc.fillColor('black').fontSize(9)
      .text('品番・品名', colX[0]+5, tableTop+5, { width: colW[0] })
      .text('数量', colX[1], tableTop+5, { width: colW[1], align: 'center' })
      .text('単価', colX[2], tableTop+5, { width: colW[2], align: 'center' })
      .text('金額', colX[3], tableTop+5, { width: colW[3], align: 'center' });

    // 明細行（10行）
    for (let i = 0; i < 10; i++) {
      const y = tableTop + 20 + i * 20;
      doc.rect(40, y, W, 20).stroke('#ccc');
      doc.rect(colX[1], y, colW[1], 20).stroke('#ccc');
      doc.rect(colX[2], y, colW[2], 20).stroke('#ccc');
      doc.rect(colX[3], y, colW[3], 20).stroke('#ccc');
      if (i === 0) {
        const qty = data.quantity || '1';
        const unit = parseInt(data.amount) || 0;
        doc.fontSize(9).fillColor('black')
          .text(data.description || '', colX[0]+5, y+5, { width: colW[0]-5 })
          .text(`${qty} 件`, colX[1], y+5, { width: colW[1], align: 'center' })
          .text(unit.toLocaleString(), colX[2], y+5, { width: colW[2], align: 'right' })
          .text(unit.toLocaleString(), colX[3], y+5, { width: colW[3], align: 'right' });
      }
    }

    // 小計・消費税・合計
    const sumY = tableTop + 20 + 10 * 20;
    const tax = Math.floor(amount / 11);
    const rows = [
      ['小計', amount.toLocaleString()],
      ['消費税（10% 内税）', `(${tax.toLocaleString()})`],
      ['合計', amount.toLocaleString()],
    ];
    rows.forEach(([label, val], i) => {
      const y = sumY + i * 22;
      doc.rect(320, y, 195, 22).stroke('#ccc');
      doc.fontSize(9).fillColor('black')
        .text(label, 325, y+6, { width: 110 })
        .text(val, 435, y+6, { width: 75, align: 'right' });
    });

    // 振込先
    const bankY = sumY + 3 * 22 + 20;
    doc.fontSize(10).font(font)
      .text('お振込先：', 40, bankY)
      .text(data.bank_info || '　', 40, bankY + 15);

    doc.end();
  });
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
