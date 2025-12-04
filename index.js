const express = require("express");
const { Telegraf } = require("telegraf");
const fs = require("fs");

const config = require("./config.json");
const bot = new Telegraf(config.BOT_TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// Load & Save User Data
// ==========================
function loadUsers() {
  if (!fs.existsSync("users.json")) fs.writeFileSync("users.json", "{}");
  return JSON.parse(fs.readFileSync("users.json"));
}
function saveUsers(data) {
  fs.writeFileSync("users.json", JSON.stringify(data, null, 2));
}

// ==========================
// Save Config Changes
// ==========================
function saveConfig() {
  fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
}

// ==========================
// Middleware for Sessions
// ==========================
const sessions = {};
function getSession(id) {
  if (!sessions[id]) sessions[id] = {};
  return sessions[id];
}

// ==========================
// START COMMAND
// ==========================
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const user = getSession(userId);

  user.step = "name";

  await ctx.reply(config.welcomeMessage);
  await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
});

// ==========================
// TEXT HANDLER
// ==========================
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const user = getSession(userId);
  const usersDB = loadUsers();
  const text = ctx.message.text.trim();

  // اگر قبلاً لینک گرفته باشد دوباره نمی‌گیرد
  if (usersDB[userId] && usersDB[userId].linkIssued) {
    return ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید ✔️");
  }

  // 1️⃣ دریافت نام
  if (user.step === "name") {
    user.name = text;
    user.step = "agreement";

    await ctx.reply("👌 عالی\nحالا لطفاً توافقنامه زیر را مطالعه کنید:\n\n" + config.agreementText);
    await ctx.reply("اگر موافق هستید عبارت «تایید میکنم» را ارسال کنید.");
    return;
  }

  // 2️⃣ تایید توافقنامه
  if (user.step === "agreement") {
    if (text !== "تایید میکنم") {
      return ctx.reply("برای ادامه فقط بنویسید: «تایید میکنم»");
    }

    user.step = "phone";

    await ctx.reply("لطفاً شماره تلگرام خود را از طریق دکمه زیر ارسال کنید 👇", {
      reply_markup: {
        keyboard: [[{ text: "ارسال شماره 📱", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });

    return;
  }

  return ctx.reply("لطفاً طبق مراحل پیش بروید.");
});

// ==========================
// CONTACT HANDLER
// ==========================
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  const contact = ctx.message.contact;
  const user = getSession(userId);

  if (contact.user_id !== userId) {
    return ctx.reply("لطفاً شماره تلگرام خودتان را ارسال کنید.");
  }

  const usersDB = loadUsers();

  if (!usersDB[userId]) usersDB[userId] = {};
  usersDB[userId].name = user.name;
  usersDB[userId].phone = contact.phone_number;
  usersDB[userId].linkIssued = true;

  saveUsers(usersDB);

  await ctx.reply("شماره شما با موفقیت ثبت شد ✔️");

  await ctx.reply("لینک یکبار مصرف ورود به کانال VIP:", {
    reply_markup: {
      inline_keyboard: [[{ text: "ورود به کانال VIP 🔑", url: config.vipLink }]],
    },
  });
});

// ==========================
// ADMIN PANEL COMMANDS
// ==========================
function isAdmin(id) {
  return config.ADMIN_IDS.includes(String(id));
}

// تغییر پیام خوش آمد
bot.command("setwelcome", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ دسترسی ندارید.");

  const newMsg = ctx.message.text.replace("/setwelcome", "").trim();
  if (!newMsg) return ctx.reply("لطفاً متن جدید را وارد کنید");

  config.welcomeMessage = newMsg;
  saveConfig();

  ctx.reply("✔ پیام خوش‌آمدگویی تغییر کرد.");
});

// تغییر توافقنامه
bot.command("setagreement", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ دسترسی ندارید.");

  const newMsg = ctx.message.text.replace("/setagreement", "").trim();
  if (!newMsg) return ctx.reply("لطفاً متن جدید را وارد کنید");

  config.agreementText = newMsg;
  saveConfig();

  ctx.reply("✔ توافقنامه تغییر کرد.");
});

// تغییر لینک VIP
bot.command("setvip", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ دسترسی ندارید.");

  const newLink = ctx.message.text.replace("/setvip", "").trim();
  if (!newLink) return ctx.reply("لطفاً لینک جدید را ارسال کنید");

  config.vipLink = newLink;
  saveConfig();

  ctx.reply("✔ لینک کانال VIP تغییر کرد.");
});

// مشاهده کاربران
bot.command("users", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ دسترسی ندارید.");

  const usersDB = loadUsers();

  if (Object.keys(usersDB).length === 0) return ctx.reply("هیچ کاربری ثبت نشده.");

  let msg = "📌 لیست کاربران ثبت شده:\n\n";

  for (const id in usersDB) {
    const u = usersDB[id];
    msg += `👤 نام: ${u.name}\n📱 شماره: ${u.phone}\n🆔 ID: ${id}\n— — — —\n`;
  }

  ctx.reply(msg);
});

// ==========================
// KEEP BOT ALWAYS ONLINE
// ==========================
app.get("/", (req, res) => res.send("Bot is running"));
app.listen(PORT, () => console.log("Server running on " + PORT));

bot.launch();
