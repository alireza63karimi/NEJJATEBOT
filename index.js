import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import express from "express";

// --------------------
// خواندن توکن از Secret File
// --------------------
let token;
try {
  token = fs.readFileSync("bot_token.txt", "utf8").trim();
  if (!token) throw new Error();
} catch {
  console.error("❌ توکن ربات پیدا نشد! لطفاً bot_token.txt را در Secret File اضافه کنید.");
  process.exit(1);
}

// --------------------
// خواندن config و users
// --------------------
let config = {};
try {
  config = JSON.parse(fs.readFileSync("config.json", "utf8"));
} catch {
  config = {};
}

config = {
  admins: Array.isArray(config.admins) ? config.admins : [],
  welcomeMessage: config.welcomeMessage || "سلام! خوش آمدید",
  agreementText: config.agreementText || "لطفاً توافقنامه را قبول کنید",
  agreementButton: config.agreementButton || "تایید میکنم ✅",
  vipPrivateLink: config.vipPrivateLink || "https://t.me/YourVIPChannel",
  pending: null
};

let users = [];
try {
  users = JSON.parse(fs.readFileSync("users.json", "utf8"));
} catch {
  users = [];
}

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

function saveConfig() {
  fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
}

function isAdmin(id) {
  return config.admins.includes(id);
}

// --------------------
// ایجاد Bot و Express
// --------------------
const bot = new Telegraf(token);
const app = express();
app.use(express.json());

// --------------------
// شروع ربات
// --------------------
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  let user = users.find(u => u.id === userId);
  if (!user) {
    user = {
      id: userId,
      fullname: null,
      username: ctx.from.username || "",
      phone: null,
      agreed: false,
      invited: false,
      step: "ask_fullname"
    };
    users.push(user);
    saveUsers();
  }
  await ctx.reply(config.welcomeMessage);
  if (user.step === "ask_fullname") {
    await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
  }
});

// --------------------
// دریافت نام و نام خانوادگی
// --------------------
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user) return;

  // دریافت نام و نام خانوادگی
  if (user.step === "ask_fullname") {
    user.fullname = ctx.message.text;
    user.step = "ask_phone";
    saveUsers();
    return ctx.reply("شماره خود را از دکمه زیر ارسال کنید:", 
      Markup.keyboard([Markup.button.contactRequest("ارسال شماره 📱")])
      .oneTime()
      .resize()
    );
  }

  // دریافت متن ادمین برای تغییر config
  if (config.pending && isAdmin(ctx.from.id)) {
    if (config.pending === "welcome") config.welcomeMessage = ctx.message.text;
    if (config.pending === "agreement") config.agreementText = ctx.message.text;
    if (config.pending === "vip") config.vipPrivateLink = ctx.message.text;
    config.pending = null;
    saveConfig();
    return ctx.reply("با موفقیت ذخیره شد ✔️");
  }
});

// --------------------
// دریافت شماره تلفن
// --------------------
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user || user.step !== "ask_phone") return;

  user.phone = ctx.message.contact.phone_number;
  user.step = "agreement";
  saveUsers();

  await ctx.reply(config.agreementText, 
    Markup.inlineKeyboard([Markup.button.callback(config.agreementButton, "agree")])
  );
});

// --------------------
// تایید توافقنامه
// --------------------
bot.action("agree", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user) return;

  user.agreed = true;
  user.step = "done";

  if (user.invited) {
    return ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید 🌟");
  }

  user.invited = true;
  saveUsers();

  return ctx.reply(`این هم لینک ورود شما به کانال VIP:\n\n${config.vipPrivateLink}`);
});

// --------------------
// داشبورد ادمین با /admin
// --------------------
bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("شما ادمین نیستید ❌");

  return ctx.reply("داشبورد مدیریت:", 
    Markup.inlineKeyboard([
      [Markup.button.callback("تغییر پیام خوش آمد ➤", "edit_welcome")],
      [Markup.button.callback("تغییر متن توافقنامه ➤", "edit_agreement")],
      [Markup.button.callback("تغییر لینک VIP ➤", "edit_viplink")],
      [Markup.button.callback("مشاهده کاربران ثبت شده", "show_users")]
    ])
  );
});

// --------------------
// ویرایش پیام و لینک
// --------------------
bot.action("edit_welcome", ctx => {
  ctx.reply("متن جدید پیام خوش آمد را ارسال کنید:");
  config.pending = "welcome";
});

bot.action("edit_agreement", ctx => {
  ctx.reply("متن جدید توافقنامه را ارسال کنید:");
  config.pending = "agreement";
});

bot.action("edit_viplink", ctx => {
  ctx.reply("لینک جدید VIP را ارسال کنید:");
  config.pending = "vip";
});

bot.action("show_users", ctx => {
  if (!isAdmin(ctx.from.id)) return;
  let text = "لیست کاربران ثبت شده:\n\n";
  users.forEach(u => {
    text += `👤 نام: ${u.fullname}\n📱 شماره: ${u.phone}\n🆔 آیدی: ${u.id}\n──────────────\n`;
  });
  ctx.reply(text || "هیچ کاربری ثبت نشده");
});

// --------------------
// راه‌اندازی Webhook با Express
// --------------------
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // در Environment Variables

app.use(express.json());

app.post(`/webhook/${token}`, (req, res) => {
  bot.handleUpdate(req.body, res)
    .then(() => res.sendStatus(200))
    .catch(err => {
      console.error("Error handling update:", err);
      res.sendStatus(500);
    });
});

// --------------------
// ست کردن Webhook
// --------------------
bot.launch({ webhook: { domain: WEBHOOK_URL, port: PORT, hookPath: `/webhook/${token}` } });
console.log(`NEJJATEBOT is running on port ${PORT}`);
