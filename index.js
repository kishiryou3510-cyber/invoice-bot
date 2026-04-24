require('dotenv/config');
const express = require('express');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('サーバー起動中です！');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動中: ポート${PORT}`);
});