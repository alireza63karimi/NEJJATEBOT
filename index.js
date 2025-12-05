const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");

const token = fs.readFileSync("bot_token.txt", "utf8").trim();
const bot = new Telegraf(token);

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

// ----------------------------
// شروع ربات
// ----------------------------
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

// ----------------------------
// دریافت نام و نام خانوادگی
// ----------------------------
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user) return;

  // نام و نام خانوادگی
  if (user.step === "ask_fullname") {
    user.fullname = ctx.message.text;
    user.step = "ask_phone";
    saveUsers();

    return ctx.reply("شماره خود را از دکمه زیر ارسال کنید:", Markup.keyboard([
      Markup.button.contactRequest("ارسال شماره 📱")
    ]).oneTime().resize());
  }

  // توافقنامه تأیید نشده
  if (user.step === "agreement") {
    return ctx.reply("لطفاً روی دکمه تایید میکنم ✅ بزنید.");
  }
});

// ----------------------------
// دریافت شماره تلفن
// ----------------------------
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

// ----------------------------
// تایید توافقنامه
// ----------------------------
bot.action("agree", async (ctx) => {
  const userId = ctx.from.id;
  const user = users.find(u => u.id === userId);
  if (!user) return;

  user.agreed = true;
  user.step = "done";
  saveUsers();

  // یک بار مصرف: هر کاربر فقط یکبار لینک بگیرد
  if (user.invited) {
    return ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید 🌟");
  }

  user.invited = true;
  saveUsers();

  return ctx.reply(`این هم لینک ورود شما به کانال VIP:\n\n${config.vipPrivateLink}`);
});

// ----------------------------
// داشبورد ادمین با /admin
// ----------------------------
bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id))
    return ctx.reply("شما ادمین نیستید ❌");

  return ctx.reply(
    "داشبورد مدیریت:",
    Markup.inlineKeyboard([
      [Markup.button.callback("تغییر پیام خوش آمد ➤", "edit_welcome")],
      [Markup.button.callback("تغییر متن توافقنامه ➤", "edit_agreement")],
      [Markup.button.callback("تغییر لینک VIP ➤", "edit_viplink")],
      [Markup.button.callback("مشاهده کاربران ثبت شده", "show_users")]
    ])
  );
});

// ----------------------------
// ویرایش پیام خوش‌آمد
// ----------------------------
bot.action("edit_welcome", (ctx) => {
  ctx.reply("متن جدید پیام خوش آمد را ارسال کنید:");
  config.pending = "welcome";
});

// ویرایش توافقنامه
bot.action("edit_agreement", (ctx) => {
  ctx.reply("متن جدید توافقنامه را ارسال کنید:");
  config.pending = "agreement";
});

// ویرایش لینک VIP
bot.action("edit_viplink", (ctx) => {
  ctx.reply("لینک جدید VIP را ارسال کنید:");
  config.pending = "vip";
});

// دریافت ورودی ادمین
bot.on("text", (ctx) => {
  const pending = config.pending;
  if (!pending || !isAdmin(ctx.from.id)) return;

  if (pending === "welcome") config.welcomeMessage = ctx.message.text;
  if (pending === "agreement") config.agreementText = ctx.message.text;
  if (pending === "vip") config.vipPrivateLink = ctx.message.text;

  config.pending = null;
  saveConfig();

  ctx.reply("با موفقیت ذخیره شد ✔️");
});

// ----------------------------
// نمایش کاربران
// ----------------------------
bot.action("show_users", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  let text = "لیست کاربران ثبت شده:\n\n";
  users.forEach(u => {
    text += `👤 نام: ${u.fullname}\n`;
    text += `📱 شماره: ${u.phone}\n`;
    text += `🆔 آیدی: ${u.id}\n`;
    text += `──────────────\n`;
  });

  ctx.reply(text || "هیچ کاربری ثبت نشده");
});

// ----------------------------
// اجرای ربات
// ----------------------------
bot.launch();
console.log("NEJJATEBOT is running...");
