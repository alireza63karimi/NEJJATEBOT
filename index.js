import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!TOKEN) {
  console.error("❌ BOT_TOKEN is missing!");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error("❌ WEBHOOK_URL is missing!");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const app = express();
app.use(express.json());

// ---------------------
// ذخیره پیام‌ها (موقت – Render پایدار نیست)
// ---------------------
function saveUserMessage(userId, message) {
  const file = "./data.json";
  let data = {};

  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file));
    } catch (e) {
      data = {};
    }
  }

  if (!data[userId]) data[userId] = [];
  data[userId].push({
    text: message,
    time: new Date().toISOString(),
  });

  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------------------
// ارسال پیام
// ---------------------
async function sendMessage(chatId, text) {
  return fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ---------------------
// ارسال عکس
// ---------------------
async function sendPhoto(chatId, url, caption) {
  return fetch(`${API}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: url,
      caption: caption || "",
    }),
  });
}

// ---------------------
// Webhook Endpoint
// ---------------------
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      saveUserMessage(chatId, text);

      if (text === "/start") {
        await sendMessage(chatId, "سلام! ربات با موفقیت فعال شد ✔️");
        return res.sendStatus(200);
      }

      if (text.startsWith("عکس")) {
        await sendPhoto(chatId, "https://picsum.photos/600", "عکس تصادفی 📸");
        return res.sendStatus(200);
      }

      await sendMessage(chatId, `پیامت رسید: ${text}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err);
    res.sendStatus(500);
  }
});

// ---------------------
// Webhook Setup
// ---------------------
async function setupWebhook() {
  const url = `${WEBHOOK_URL}/webhook/${TOKEN}`;

  console.log("Setting webhook →", url);

  const response = await fetch(`${API}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const json = await response.json();
  console.log("Webhook set result:", json);
}

// ---------------------
// Start Server
// ---------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("🚀 Server running on:", PORT);
  await setupWebhook();
});
