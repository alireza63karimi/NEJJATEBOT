const fs = require('fs');
const express = require('express');
const { Telegraf } = require('telegraf');

// Load config safely
let config = { adminIds: [], welcomeMessage: "", agreementText: "", vipChannelId: "", vipChannelLink: "" };
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (err) {
  console.error("خطا در خواندن config.json. لطفاً فایل را بررسی کنید.", err.message);
  process.exit(1);
}

// Load bot token
let BOT_TOKEN = "";
try {
  BOT_TOKEN = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf8').trim();
} catch (err) {
  console.error("خطا در خواندن bot_token.txt. توکن موجود نیست یا مسیر اشتباه است.", err.message);
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

// Load or create users file
const USERS_FILE = 'users.json';
let users = [];
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    users = [];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
} else {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Save users helper
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Check admin
function isAdmin(id) {
  return config.adminIds.includes(id);
}

// Generate one-time invite link
async function generateInviteLink(ctx) {
  if (!config.vipChannelId) return null;
  try {
    return await ctx.telegram.exportChatInviteLink(config.vipChannelId);
  } catch (err) {
    console.error("Invite link error:", err.message);
    return null;
  }
}

// START command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  let user = users.find(u => u.id === userId);

  if (!user) {
    user = {
      id: userId,
      first_name: ctx.from.first_name || "",
      last_name: ctx.from.last_name || "",
      username: ctx.from.username || "",
      phone: "",
      vipSent: false,
      joinDate: new Date().toISOString()
    };
    users.push(user);
    saveUsers();
  }

  await ctx.reply(config.welcomeMessage, {
    reply_markup: {
      keyboard: [[{ text: "ارسال شماره 📱", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

// CONTACT handler
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  const contact = ctx.message.contact;
  let user = users.find(u => u.id === userId);
  if (!user) return;

  user.phone = contact.phone_number;
  saveUsers();

  await ctx.reply(config.agreementText, {
    reply_markup: {
      inline_keyboard: [[{ text: "تایید میکنم ✅", callback_data: "agree" }]]
    }
  });
});

// AGREEMENT → Send VIP link
bot.on("callback_query", async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  let user = users.find(u => u.id === userId);
  if (!user) return ctx.answerCbQuery("خطا!");

  if (data === "agree") {
    if (user.vipSent) {
      await ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید.");
    } else {
      let inviteLink = await generateInviteLink(ctx);
      if (!inviteLink) inviteLink = config.vipChannelLink;
      await ctx.reply(`لینک VIP شما 👇\n${inviteLink}`);
      user.vipSent = true;
      saveUsers();
    }
  }
  await ctx.answerCbQuery();
});

// ADMIN: show users
bot.command("users", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  if (users.length === 0) return ctx.reply("هیچ کاربری وجود ندارد.");

  const list = users
    .map(u => `👤 ${u.first_name} ${u.last_name} | @${u.username}\n📱 ${u.phone || 'ندارد'}\n📅 ${u.joinDate}\n—————`)
    .join("\n");

  await ctx.reply(list);
});

// ADMIN: update welcome message
bot.command("setwelcome", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return ctx.reply("لطفاً متن جدید را بعد از دستور وارد کنید.");
  config.welcomeMessage = text;
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  await ctx.reply("پیام خوش‌آمد جدید ذخیره شد ✅");
});

// ADMIN: update agreement text
bot.command("setagreement", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return ctx.reply("لطفاً متن جدید را بعد از دستور وارد کنید.");
  config.agreementText = text;
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  await ctx.reply("متن توافقنامه جدید ذخیره شد ✅");
});

// ADMIN: update VIP link
bot.command("setvip", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return ctx.reply("لطفاً لینک جدید را بعد از دستور وارد کنید.");
  config.vipChannelLink = text;
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  await ctx.reply("لینک VIP جدید ذخیره شد ✅");
});

// Webhook
app.use(bot.webhookCallback('/bot'));
app.get('/', (req, res) => res.send("Bot is running!"));

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const url = process.env.WEBHOOK_URL || "https://YOUR_RENDER_URL.onrender.com";
  try {
    await bot.telegram.setWebhook(`${url}/bot`);
    console.log("Webhook set successfully.");
  } catch (err) {
    console.error("خطا در تنظیم webhook:", err.message);
  }
});
