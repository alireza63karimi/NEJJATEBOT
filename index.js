import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// -----------------------------
// Environment Variables
// -----------------------------
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !WEBHOOK_URL) {
  console.error("❌ BOT_TOKEN یا WEBHOOK_URL تنظیم نشده است!");
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
// کمک‌کننده‌ها
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

async function sendMessage(chatId, text, replyMarkup = null) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup, parse_mode: "HTML" }),
  });
}

function inlineKeyboard(buttons) {
  return { inline_keyboard: buttons };
}

// -----------------------------
// Webhook
// -----------------------------
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  const update = req.body;

  try {
    // ---------- پیام معمولی ----------
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";
      const username = update.message.from.username || "";
      const fullname = `${update.message.from.first_name || ""} ${update.message.from.last_name || ""}`.trim();

      if (!users[chatId]) {
        users[chatId] = {
          id: chatId,
          step: "ask_fullname",
          fullname: null,
          username,
          phone: null,
          agreed: false,
          invited: false,
        };
        saveUsers();
      }

      const user = users[chatId];

      // دستور /start
      if (text === "/start") {
        user.step = "ask_fullname";
        saveUsers();
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, "لطفاً نام و نام خانوادگی خود را ارسال کنید:");
        return res.sendStatus(200);
      }

      // دریافت نام و نام خانوادگی
      if (user.step === "ask_fullname") {
        user.fullname = text;
        user.step = "ask_phone";
        saveUsers();

        await sendMessage(chatId, "شماره خود را از دکمه زیر ارسال کنید:", {
          keyboard: [[{ text: "ارسال شماره 📱", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        });
        return res.sendStatus(200);
      }

      // توافقنامه
      if (user.step === "agreement") {
        await sendMessage(chatId, `لطفاً روی دکمه ${config.agreementButton} بزنید.`);
        return res.sendStatus(200);
      }

      // داشبورد ادمین
      if (text === "/admin" && isAdmin(chatId)) {
        await sendMessage(chatId, "داشبورد مدیریت:", inlineKeyboard([
          [{ text: "تغییر پیام خوش آمد ➤", callback_data: "edit_welcome" }],
          [{ text: "تغییر متن توافقنامه ➤", callback_data: "edit_agreement" }],
          [{ text: "تغییر لینک VIP ➤", callback_data: "edit_viplink" }],
          [{ text: "مشاهده کاربران ثبت شده", callback_data: "show_users" }],
          [{ text: "اضافه کردن ادمین", callback_data: "add_admin" }],
          [{ text: "حذف ادمین", callback_data: "remove_admin" }],
        ]));
        return res.sendStatus(200);
      }
    }

    // ---------- اکشن‌های Inline ----------
    if (update.callback_query) {
      const chatId = update.callback_query.from.id;
      const data = update.callback_query.data;

      if (!users[chatId]) return res.sendStatus(200);
      const user = users[chatId];

      if (!isAdmin(chatId)) return res.sendStatus(200);

      if (data === "edit_welcome") {
        user.pending = "welcome";
        saveUsers();
        await sendMessage(chatId, "متن جدید پیام خوش آمد را ارسال کنید:");
      } else if (data === "edit_agreement") {
        user.pending = "agreement";
        saveUsers();
        await sendMessage(chatId, "متن جدید توافقنامه را ارسال کنید:");
      } else if (data === "edit_viplink") {
        user.pending = "vip";
        saveUsers();
        await sendMessage(chatId, "لینک جدید VIP را ارسال کنید:");
      } else if (data === "show_users") {
        let text = "لیست کاربران ثبت شده:\n\n";
        Object.values(users).forEach(u => {
          text += `👤 ${u.fullname}\n📱 ${u.phone || "-"}\n🆔 ${u.id}\n──────────────\n`;
        });
        await sendMessage(chatId, text || "هیچ کاربری ثبت نشده");
      } else if (data === "add_admin") {
        user.pending = "add_admin";
        saveUsers();
        await sendMessage(chatId, "آیدی یا یوزرنیم ادمین جدید را ارسال کنید:");
      } else if (data === "remove_admin") {
        user.pending = "remove_admin";
        saveUsers();
        await sendMessage(chatId, "آیدی یا یوزرنیم ادمین را برای حذف ارسال کنید:");
      }

      return res.sendStatus(200);
    }

    // ---------- دریافت پیام ادمین برای تغییر تنظیمات ----------
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const user = users[chatId];
      if (!user || !isAdmin(chatId) || !user.pending) return res.sendStatus(200);

      if (user.pending === "welcome") {
        config.welcomeMessage = text;
        saveConfig();
        user.pending = null;
        saveUsers();
        await sendMessage(chatId, "پیام خوش آمد با موفقیت ذخیره شد ✔️");
      } else if (user.pending === "agreement") {
        config.agreementText = text;
        saveConfig();
        user.pending = null;
        saveUsers();
        await sendMessage(chatId, "توافقنامه با موفقیت ذخیره شد ✔️");
      } else if (user.pending === "vip") {
        config.vipPrivateLink = text;
        saveConfig();
        user.pending = null;
        saveUsers();
        await sendMessage(chatId, "لینک VIP با موفقیت ذخیره شد ✔️");
      } else if (user.pending === "add_admin") {
        if (!config.admins.includes(Number(text))) config.admins.push(Number(text));
        saveConfig();
        user.pending = null;
        saveUsers();
        await sendMessage(chatId, "ادمین جدید با موفقیت اضافه شد ✔️");
      } else if (user.pending === "remove_admin") {
        config.admins = config.admins.filter(a => a !== Number(text));
        saveConfig();
        user.pending = null;
        saveUsers();
        await sendMessage(chatId, "ادمین حذف شد ✔️");
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err);
    res.sendStatus(500);
  }
});

// -----------------------------
// Webhook
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
// Run server
// -----------------------------
app.listen(PORT, async () => {
  console.log("Server running on port:", PORT);
  await setWebhook();
});
