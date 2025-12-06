import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// -----------------------------
// خواندن توکن از Secret File
// -----------------------------
const TOKEN_PATH = "/etc/secrets/bot_token.txt";
if (!fs.existsSync(TOKEN_PATH)) {
  console.error("❌ فایل bot_token.txt موجود نیست یا مسیر اشتباه است!");
  process.exit(1);
}
const TOKEN = fs.readFileSync(TOKEN_PATH, "utf8").trim();

// -----------------------------
// Webhook URL و Port
// -----------------------------
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!WEBHOOK_URL) {
  console.error("❌ WEBHOOK_URL تنظیم نشده است!");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const app = express();
app.use(express.json());

// -----------------------------
// فایل‌ها
// -----------------------------
const CONFIG_FILE = path.resolve("./config.json");
const USERS_FILE = path.resolve("./users.json");

let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE))
  : {
      welcomeMessage:
        "هم فرکانسی عزیز خوش آمدی! برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید.",
      agreementText:
        "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
      agreementButton: "تایید میکنم ✅",
      vipPrivateLink: "https://t.me/YourVIPChannel",
      admins: [],
    };

let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : {};

// -----------------------------
// توابع کمکی
// -----------------------------
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function isAdmin(id) {
  return config.admins.includes(id);
}
async function sendMessage(chatId, text, replyMarkup) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
}
async function sendKeyboard(chatId, text, buttons) {
  const markup = { keyboard: buttons, resize_keyboard: true, one_time_keyboard: true };
  await sendMessage(chatId, text, markup);
}
async function sendInlineKeyboard(chatId, text, inlineButtons) {
  const markup = { inline_keyboard: inlineButtons };
  await sendMessage(chatId, text, markup);
}

// -----------------------------
// مدیریت کاربران و مراحل
// -----------------------------
function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = { id: chatId, step: "ask_fullname", fullname: "", username: "", phone: "", agreed: false, invited: false };
  }
  return users[chatId];
}

// -----------------------------
// Webhook endpoint
// -----------------------------
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  const update = req.body;

  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const user = getUser(chatId);

      // ذخیره یوزرنیم
      user.username = update.message.from.username || "";

      // --- دستور /start
      if (update.message.text === "/start") {
        user.step = "ask_fullname";
        saveUsers();
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, "لطفاً نام و نام خانوادگی خود را ارسال کنید:");
        return res.sendStatus(200);
      }

      // مراحل نام و نام خانوادگی
      if (user.step === "ask_fullname" && update.message.text) {
        user.fullname = update.message.text;
        user.step = "ask_phone";
        saveUsers();
        await sendKeyboard(chatId, "شماره خود را از دکمه زیر ارسال کنید:", [[{ text: "ارسال شماره 📱", request_contact: true }]]);
        return res.sendStatus(200);
      }

      // مرحله شماره
      if (user.step === "ask_phone" && update.message.contact) {
        user.phone = update.message.contact.phone_number;
        user.step = "agreement";
        saveUsers();
        await sendInlineKeyboard(chatId, config.agreementText, [[{ text: config.agreementButton, callback_data: "agree" }]]);
        return res.sendStatus(200);
      }
    }

    // --- پاسخ به Callback Query
    if (update.callback_query) {
      const chatId = update.callback_query.from.id;
      const user = getUser(chatId);

      if (update.callback_query.data === "agree") {
        user.agreed = true;
        user.step = "done";
        saveUsers();

        if (!user.invited || isAdmin(chatId)) {
          user.invited = true;
          saveUsers();
          await sendMessage(chatId, `این هم لینک ورود شما به کانال VIP:\n\n${config.vipPrivateLink}`);
        } else {
          await sendMessage(chatId, "شما قبلاً لینک VIP را دریافت کرده‌اید 🌟");
        }
        return res.sendStatus(200);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err);
    res.sendStatus(500);
  }
});

// -----------------------------
// فعال‌سازی Webhook
// -----------------------------
async function setWebhook() {
  const url = `${WEBHOOK_URL}/webhook/${TOKEN}`;
  const result = await fetch(`${API}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await result.json();
  console.log("Webhook set:", data);
}

// -----------------------------
// اجرای سرور
// -----------------------------
app.listen(PORT, async () => {
  console.log("Server running on port:", PORT);
  await setWebhook();
});
