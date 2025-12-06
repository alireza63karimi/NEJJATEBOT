import express from "express";
import fs from "fs";
import { Telegraf } from "telegraf";

const BOT_TOKEN = fs.readFileSync("./bot_token.txt", "utf8").trim();
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN) {
  console.error("❌ bot_token.txt IS EMPTY");
  process.exit(1);
}

// START BOT
const bot = new Telegraf(BOT_TOKEN);

// Load config
let config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
let users = JSON.parse(fs.readFileSync("./users.json", "utf8"));

// SAVE FUNCTIONS
function saveUsers() {
  fs.writeFileSync("./users.json", JSON.stringify(users, null, 2));
}
function saveConfig() {
  fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
}

// CHECK ADMIN
function isAdmin(userId) {
  return config.admins.includes(Number(userId));
}

// CREATE VIP INVITE LINK
async function getVipLink() {
  try {
    if (!config.vipChannelId || config.vipChannelId.trim() === "") {
      return config.vipChannelLink;
    }
    const link = await bot.telegram.exportChatInviteLink(config.vipChannelId);
    return link;
  } catch (err) {
    console.log("VIP LINK ERROR:", err);
    return config.vipChannelLink;
  }
}

// START MESSAGE
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  users[userId] = users[userId] || {};
  saveUsers();

  await ctx.reply(config.welcomeMessage, {
    reply_markup: {
      keyboard: [[{ text: "ارسال شماره من 📱", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
});

// RECEIVE CONTACT
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  const c = ctx.message.contact;

  users[userId] = {
    id: userId,
    name: ctx.from.first_name || "",
    username: ctx.from.username || "",
    phone: c.phone_number,
    vipSent: false,
  };

  saveUsers();

  await ctx.reply(config.agreementText, {
    reply_markup: {
      inline_keyboard: [[{ text: config.agreementButton, callback_data: "AGREE" }]],
    },
  });
});

// USER AGREES
bot.action("AGREE", async (ctx) => {
  const userId = ctx.from.id;

  if (!users[userId]) return;

  if (!users[userId].vipSent) {
    const link = await getVipLink();

    await ctx.reply(`لینک عضویت VIP شما:\n${link}`);
    users[userId].vipSent = true;
    saveUsers();
  } else {
    await ctx.reply("⚠️ شما قبلاً لینک کانال VIP را دریافت کرده‌اید.");
  }

  await ctx.answerCbQuery();
});

// ADMIN PANEL
bot.command("ADMIN", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ شما ادمین نیستید.");
  }

  await ctx.reply(
    "🔐 پنل مدیریت:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 تغییر متن خوش‌آمد", callback_data: "SET_WELCOME" }],
          [{ text: "📄 تغییر متن توافقنامه", callback_data: "SET_AGREEMENT" }],
          [{ text: "🔗 تغییر لینک VIP", callback_data: "SET_VIP_LINK" }],
          [{ text: "👥 مشاهده کاربران", callback_data: "SHOW_USERS" }],
        ],
      },
    }
  );
});

// HANDLE ADMIN ACTIONS
bot.action("SET_WELCOME", (ctx) => {
  ctx.reply("متن جدید خوش‌آمد را ارسال کنید:");
  config.waiting = "WELCOME";
  saveConfig();
});

bot.action("SET_AGREEMENT", (ctx) => {
  ctx.reply("متن جدید توافقنامه را ارسال کنید:");
  config.waiting = "AGREEMENT";
  saveConfig();
});

bot.action("SET_VIP_LINK", (ctx) => {
  ctx.reply("لینک جدید VIP را ارسال کنید:");
  config.waiting = "VIPLINK";
  saveConfig();
});

bot.action("SHOW_USERS", (ctx) => {
  let text = "📌 کاربران ثبت شده:\n\n";
  for (let id in users) {
    let u = users[id];
    text += `👤 ${u.name} | @${u.username} | ${u.phone}\n`;
  }
  ctx.reply(text);
  ctx.answerCbQuery();
});

// UPDATE SETTINGS
bot.on("text", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const t = ctx.message.text;

  if (config.waiting === "WELCOME") {
    config.welcomeMessage = t;
    config.waiting = null;
    saveConfig();
    return ctx.reply("✔ پیام خوش‌آمد تغییر کرد.");
  }

  if (config.waiting === "AGREEMENT") {
    config.agreementText = t;
    config.waiting = null;
    saveConfig();
    return ctx.reply("✔ متن توافقنامه تغییر کرد.");
  }

  if (config.waiting === "VIPLINK") {
    config.vipChannelLink = t;
    config.waiting = null;
    saveConfig();
    return ctx.reply("✔ لینک VIP تغییر کرد.");
  }
});

// EXPRESS + WEBHOOK
const app = express();
app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("BOT IS RUNNING ✓"));

bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`);

app.listen(3000, () => console.log("BOT RUNNING ON PORT 3000"));
