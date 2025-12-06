import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // آدرس Render شما

const app = express();
app.use(express.json());

// ---------------------
// ذخیره در فایل JSON
// ---------------------
function saveUserMessage(userId, message) {
  const file = "./data.json";
  let data = {};

  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file));
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
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// ---------------------
// ارسال عکس
// ---------------------
async function sendPhoto(chatId, url, caption) {
  await fetch(`${API}/sendPhoto`, {
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
  const update = req.body;

  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      saveUserMessage(chatId, text);

      // --- دستور /start
      if (text === "/start") {
        await sendMessage(chatId, "سلام! ربات با موفقیت فعال شد 😊");
        return res.sendStatus(200);
      }

      // --- دستور دریافت تصویر
      if (text.startsWith("عکس")) {
        await sendPhoto(
          chatId,
          "https://picsum.photos/600",
          "این هم یک عکس تصادفی!"
        );
        return res.sendStatus(200);
      }

      // --- پاسخ به سایر پیام‌ها
      await sendMessage(chatId, `پیامت رسید: ${text}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err);
    res.sendStatus(500);
  }
});

// ---------------------
// فعال‌سازی Webhook
// ---------------------
async function setWebhook() {
  const url = `${WEBHOOK_URL}/webhook/${TOKEN}`;
  const result = await fetch(`${API}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const res = await result.json();
  console.log("Webhook set:", res);
}

// ---------------------
// اجرای سرور
// ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("Server running on port:", PORT);
  await setWebhook();
});
