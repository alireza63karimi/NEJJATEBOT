import express from "express";
import { Telegraf, Markup } from "telegraf";
import fs from "fs";

// -------------------------
// خواندن توکن ربات
// -------------------------
let TOKEN = process.env.BOT_TOKEN || "";
if (!TOKEN) {
  try {
    // بررسی Secret File
    TOKEN = fs.readFileSync("/etc/secrets/bot_token.txt", "utf8").trim();
  } catch (err) {
    console.error("❌ توکن ربات پیدا نشد! لطفاً BOT_TOKEN را در Environment Variables یا Secret File قرار دهید.");
    process.exit(1);
  }
}

// -------------------------
// پورت و Webhook
// -------------------------
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
if (!WEBHOOK_URL) {
  console.error("❌ WEBHOOK_URL تنظیم نشده است!");
  process.exit(1);
}

// -------------------------
// فایل‌های کانفیگ و کاربران
// -------------------------
const CONFIG_FILE = "./config.json";
const USERS_FILE = "./users.json";

let config = { welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
               agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
               agreementButton: "تایید میکنم ✅",
               vipPrivateLink: "",
               admins: [] };

let users = [];

try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch {}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function isAdmin(id) {
  return config.admins.includes(id);
}

// -------------------------
// ایجاد ربات
// -------------------------
const bot = new Telegraf(TOKEN);

// -------------------------
// شروع ربات
// -------------------------
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  if (!users.find(u => u.id === userId)) {
    users.push({
      id: userId,
      step: "ask_fullname",
      fullname: null,
      username: ctx.from.username || "",
      phone: null,
      agreed: false,
      invited: false
    });
    saveUsers();
  }

  await ctx.reply(config.welcomeMessage);
  await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
});

// -------------------------
// دریافت نام و نام خانوادگی و شماره
// -------------------------
bot.on("text", async (ctx) => {
  const user = users.find(u => u.id === ctx.from.id);
  if (!user) return;

  if (user.step === "ask_fullname") {
    user.fullname = ctx.message.text;
    user.step = "ask_phone";
    saveUsers();
    return ctx.reply("شماره خود را از دکمه زیر ارسال کنید:", Markup.keyboard([
      Markup.button.contactRequest("ارسال شماره 📱")
    ]).oneTime().resize());
  }

  if (user.step === "agreement") {
    return ctx.reply("لطفاً روی دکمه تایید میکنم ✅ بزنید.");
  }

  // ویرایش توسط ادمین
  const pending = config.pending;
  if (pending && isAdmin(ctx.from.id)) {
    if (pending === "welcome") config.welcomeMessage = ctx.message.text;
    if (pending === "agreement") config.agreementText = ctx.message.text;
    if (pending === "vip") config.vipPrivateLink = ctx.message.text;
    config.pending = null;
    saveConfig();
    return ctx.reply("با موفقیت ذخیره شد ✔️");
  }
});

bot.on("contact", async (ctx) => {
  const user = users.find(u => u.id === ctx.from.id);
  if (!user || user.step !== "ask_phone") return;

  user.phone = ctx.message.contact.phone_number;
  user.step = "agreement";
  saveUsers();

  await ctx.reply(config.agreementText, Markup.inlineKeyboard([
    Markup.button.callback(config.agreementButton, "agree")
  ]));
});

bot.action("agree", async (ctx) => {
  const user = users.find(u => u.id === ctx.from.id);
  if (!user) return;

  user.agreed = true;
  user.step = "done";

  // هر کاربر فقط یکبار لینک بگیرد
  if (!user.invited) {
    user.invited = true;
    await ctx.reply(`این هم لینک ورود شما به کانال VIP:\n\n${config.vipPrivateLink}`);
  } else {
    await ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید 🌟");
  }
  saveUsers();
});

// -------------------------
// داشبورد ادمین
// -------------------------
bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("شما ادمین نیستید ❌");

  return ctx.reply("داشبورد مدیریت:", Markup.inlineKeyboard([
    [Markup.button.callback("تغییر پیام خوش آمد ➤", "edit_welcome")],
    [Markup.button.callback("تغییر متن توافقنامه ➤", "edit_agreement")],
    [Markup.button.callback("تغییر لینک VIP ➤", "edit_viplink")],
    [Markup.button.callback("مشاهده کاربران ثبت شده", "show_users")]
  ]));
});

bot.action("edit_welcome", (ctx) => { ctx.reply("متن جدید پیام خوش آمد را ارسال کنید:"); config.pending = "welcome"; });
bot.action("edit_agreement", (ctx) => { ctx.reply("متن جدید توافقنامه را ارسال کنید:"); config.pending = "agreement"; });
bot.action("edit_viplink", (ctx) => { ctx.reply("لینک جدید VIP را ارسال کنید:"); config.pending = "vip"; });

bot.action("show_users", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  let text = "لیست کاربران ثبت شده:\n\n";
  users.forEach(u => {
    text += `👤 نام: ${u.fullname}\n📱 شماره: ${u.phone}\n🆔 آیدی: ${u.id}\n──────────────\n`;
  });
  ctx.reply(text || "هیچ کاربری ثبت نشده");
});

// -------------------------
// Webhook با Express
// -------------------------
const app = express();
app.use(express.json());

app.use(bot.webhookCallback(`/webhook/${TOKEN}`));

app.get("/", (req, res) => res.send("NEJJATEBOT is running..."));

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook/${TOKEN}`);
  console.log("Webhook set:", `${WEBHOOK_URL}/webhook/${TOKEN}`);
});
