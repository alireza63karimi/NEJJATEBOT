const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const express = require("express");

// --------------------------------------------------
// خواندن توکن از فایل Secret روی Render
// --------------------------------------------------
const token = fs.readFileSync("bot_token.txt", "utf8").trim();
const bot = new Telegraf(token);

// --------------------------------------------------
// خواندن فایل‌های تنظیمات
// --------------------------------------------------
let config = JSON.parse(fs.readFileSync("config.json", "utf8"));
let users = JSON.parse(fs.readFileSync("users.json", "utf8"));

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

function saveConfig() {
  fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
}

function isAdmin(id) {
  return config.admins.includes(id);
}

// --------------------------------------------------
// شروع ربات
// --------------------------------------------------
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

// --------------------------------------------------
// دریافت نام و نام خانوادگی
// --------------------------------------------------
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user) return;

  if (user.step === "ask_fullname") {
    user.fullname = ctx.message.text;
    user.step = "ask_phone";
    saveUsers();

    return ctx.reply(
      "شماره خود را از دکمه زیر ارسال کنید:",
      Markup.keyboard([
        Markup.button.contactRequest("ارسال شماره 📱")
      ]).oneTime().resize()
    );
  }

  if (user.step === "agreement") {
    return ctx.reply("لطفاً روی دکمه تایید میکنم ✅ بزنید.");
  }

  // مدیریت حالت های ادمین
  if (isAdmin(userId) && config.pending) {
    if (config.pending === "welcome") config.welcomeMessage = ctx.message.text;
    if (config.pending === "agreement") config.agreementText = ctx.message.text;
    if (config.pending === "vip") config.vipPrivateLink = ctx.message.text;

    config.pending = null;
    saveConfig();

    return ctx.reply("با موفقیت ذخیره شد ✔️");
  }
});

// --------------------------------------------------
// دریافت شماره تلفن
// --------------------------------------------------
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user || user.step !== "ask_phone") return;

  user.phone = ctx.message.contact.phone_number;
  user.step = "agreement";
  saveUsers();

  await ctx.reply(
    config.agreementText,
    Markup.inlineKeyboard([
      Markup.button.callback(config.agreementButton, "agree")
    ])
  );
});

// --------------------------------------------------
// تایید توافقنامه
// --------------------------------------------------
bot.action("agree", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user) return;

  user.agreed = true;
  user.step = "done";
  saveUsers();

  if (user.invited && !isAdmin(userId)) {
    return ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید 🌟");
  }

  user.invited = true;
  saveUsers();

  return ctx.reply(`لینک ورود به کانال VIP:\n${config.vipPrivateLink}`);
});

// --------------------------------------------------
// داشبورد ادمین
// --------------------------------------------------
bot.command("admin", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("شما ادمین نیستید ❌");

  return ctx.reply(
    "داشبورد مدیریت:",
    Markup.inlineKeyboard([
      [Markup.button.callback("تغییر پیام خوش‌آمد ➤", "edit_welcome")],
      [Markup.button.callback("تغییر متن توافقنامه ➤", "edit_agreement")],
      [Markup.button.callback("تغییر لینک VIP ➤", "edit_viplink")],
      [Markup.button.callback("مشاهده کاربران ثبت‌شده", "show_users")]
    ])
  );
});

// --------------------------------------------------
// اکشن‌های ادمین
// --------------------------------------------------
bot.action("edit_welcome", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  config.pending = "welcome";
  ctx.reply("متن جدید پیام خوش آمد را ارسال کنید:");
});

bot.action("edit_agreement", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  config.pending = "agreement";
  ctx.reply("متن جدید توافقنامه را ارسال کنید:");
});

bot.action("edit_viplink", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  config.pending = "vip";
  ctx.reply("لینک جدید VIP را ارسال کنید:");
});

// --------------------------------------------------
// نمایش کاربران
// --------------------------------------------------
bot.action("show_users", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  if (users.length === 0) return ctx.reply("کاربری ثبت نشده");

  let txt = "";
  users.forEach(u => {
    txt += `👤 ${u.fullname}\n📱 ${u.phone}\n🆔 ${u.id}\n──────────────\n`;
  });

  ctx.reply(txt);
});

// --------------------------------------------------
// فعال‌سازی Webhook + Express برای Render
// --------------------------------------------------
const app = express();
app.use(express.json());

// مسیر وبهوک
app.post(`/webhook/${token}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// پورت رندر
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);

  bot.telegram.setWebhook(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook/${token}`);
  console.log("Webhook set!");
});
