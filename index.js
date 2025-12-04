const express = require("express");
const fs = require("fs");

// ──────────────── SERVER (Keep Alive) ────────────────
const app = express();
app.get("/", (req, res) => res.send("Bot is running..."));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server started on port", PORT));

// ──────────────── READ TELEGRAM BOT TOKEN ────────────────
// Render Secret File location:
/*
  Secret file name: bot_token.txt
  Render path: /etc/secrets/bot_token.txt
*/

let BOT_TOKEN = null;

try {
  BOT_TOKEN = fs.readFileSync("/etc/secrets/bot_token.txt", "utf8").trim();
  console.log("BOT TOKEN LOADED FROM SECRET FILE.");
} catch (err) {
  console.error("❌ ERROR: BOT TOKEN FILE NOT FOUND!");
  process.exit(1);
}

// ──────────────── LOAD CONFIG ────────────────
const config = JSON.parse(fs.readFileSync("config.json"));
const admins = config.admins;

// Load users
let users = {};
if (fs.existsSync("users.json")) {
  users = JSON.parse(fs.readFileSync("users.json"));
}

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

// ──────────────── TELEGRAM BOT ────────────────
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ──────────────── START HANDLER ────────────────
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;

  // If admin → show admin panel
  if (admins.includes(id)) {
    return bot.sendMessage(id, "👑 *پنل مدیریت*", {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [
          ["📌 تغییر پیام خوش‌آمد"],
          ["📄 تغییر متن توافقنامه"],
          ["🔗 تغییر لینک VIP"],
          ["👥 مشاهده کاربران"],
        ],
        resize_keyboard: true,
      },
    });
  }

  // User flow
  bot.sendMessage(id, config.welcomeMessage);

  bot.sendMessage(id, "لطفاً نام و نام خانوادگی خود را وارد کنید:");

  users[id] = { step: "name" };
});

// ──────────────── USER FLOW ────────────────
bot.on("message", (msg) => {
  const id = msg.chat.id;
  const text = msg.text;

  if (!users[id] || admins.includes(id)) return;

  // Step 1 — name
  if (users[id].step === "name") {
    users[id].name = text;
    users[id].step = "phone";

    bot.sendMessage(id, "لطفاً شماره تلگرام خود را ارسال کنید:", {
      reply_markup: {
        keyboard: [[{ text: "ارسال شماره", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });

    return;
  }
});

// Step 2 — phone
bot.on("contact", (msg) => {
  const id = msg.chat.id;

  if (!users[id]) return;

  users[id].phone = msg.contact.phone_number;
  users[id].step = "agreement";

  bot.sendMessage(
    id,
    "لطفاً متن توافقنامه زیر را تایید کنید:\n\n" + config.agreementText,
    {
      reply_markup: {
        keyboard: [["تایید میکنم"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
});

// Step 3 — agreement
bot.on("message", (msg) => {
  const id = msg.chat.id;

  if (!users[id]) return;

  if (users[id].step === "agreement" && msg.text === "تایید میکنم") {
    if (users[id].linkSent) {
      return bot.sendMessage(id, "شما قبلاً لینک را دریافت کرده‌اید.");
    }

    users[id].linkSent = true;
    users[id].step = "done";
    saveUsers();

    bot.sendMessage(id, "🔗 لینک VIP شما:\n" + config.vipLink, {
      reply_markup: { remove_keyboard: true },
    });
  }
});

// ──────────────── ADMIN PANEL ────────────────
let adminState = {};

bot.on("message", (msg) => {
  const id = msg.chat.id;
  const text = msg.text;

  if (!admins.includes(id)) return;

  // Change Welcome Text
  if (text === "📌 تغییر پیام خوش‌آمد") {
    adminState[id] = "editWelcome";
    return bot.sendMessage(id, "متن جدید پیام خوش‌آمد را ارسال کنید:");
  }

  if (adminState[id] === "editWelcome") {
    config.welcomeMessage = text;
    fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
    adminState[id] = null;
    return bot.sendMessage(id, "✔ پیام خوش‌آمد با موفقیت تغییر کرد.");
  }

  // Change Agreement
  if (text === "📄 تغییر متن توافقنامه") {
    adminState[id] = "editAgree";
    return bot.sendMessage(id, "متن جدید توافقنامه را ارسال کنید:");
  }

  if (adminState[id] === "editAgree") {
    config.agreementText = text;
    fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
    adminState[id] = null;
    return bot.sendMessage(id, "✔ متن توافقنامه تغییر کرد.");
  }

  // Change VIP Link
  if (text === "🔗 تغییر لینک VIP") {
    adminState[id] = "editLink";
    return bot.sendMessage(id, "لینک جدید VIP را ارسال کنید:");
  }

  if (adminState[id] === "editLink") {
    config.vipLink = text;
    fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
    adminState[id] = null;
    return bot.sendMessage(id, "✔ لینک VIP با موفقیت تغییر کرد.");
  }

  // Show all users
  if (text === "👥 مشاهده کاربران") {
    let output = "📌 لیست کاربران ثبت‌نام‌شده:\n\n";

    for (const uid in users) {
      const u = users[uid];
      if (u.name)
        output += `ID: ${uid}\nنام: ${u.name}\nشماره: ${u.phone}\n\n`;
    }

    return bot.sendMessage(id, output || "هیچ کاربری ثبت نشده است.");
  }
});
