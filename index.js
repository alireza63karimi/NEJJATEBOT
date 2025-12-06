/**
 * NEJJATEBOT - index.js
 * Webhook mode for Render (Express)
 *
 * Requirements on Render:
 *  - Secret File: bot_token.txt (content = BOT TOKEN)  -> available at /etc/secrets/bot_token.txt
 *  - Environment Variable: WEBHOOK_URL = https://your-service.onrender.com
 *  - PORT provided by Render (process.env.PORT)
 *
 * Files in repo: package.json, index.js, config.json, users.json
 */
import fs from "fs";
import { Telegraf, Markup } from "telegraf";
import express from "express";
import path from "path";

// ---------- Paths ----------
const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "config.json");
const USERS_PATH = path.join(ROOT, "users.json");

// ---------- Load config safely ----------
let config = {
  welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
  agreementButton: "تایید میکنم ✅",
  vipChannelId: "",
  vipChannelLink: "https://t.me/NEJJATE_VIP",
  admins: []
};
try {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  config = { ...config, ...parsed };
  if (!Array.isArray(config.admins)) config.admins = [];
} catch (e) {
  console.warn("config.json not found or invalid, using defaults.");
  // will create later if needed
}

// ---------- Load users safely ----------
let users = [];
try {
  if (fs.existsSync(USERS_PATH)) {
    const raw = fs.readFileSync(USERS_PATH, "utf8");
    users = JSON.parse(raw);
    if (!Array.isArray(users)) users = [];
  } else {
    users = [];
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  }
} catch (e) {
  console.warn("users.json missing or invalid; initializing empty array.");
  users = [];
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

// ---------- Helpers ----------
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to save config.json:", e.message || e);
  }
}
function saveUsers() {
  try {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error("Failed to save users.json:", e.message || e);
  }
}
function findUserById(id) {
  return users.find(u => Number(u.id) === Number(id));
}
function isAdmin(id) {
  if (!Array.isArray(config.admins)) return false;
  // allow string or number matching
  return config.admins.map(a => String(a)).includes(String(id));
}
function chunkText(text, size = 3500) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// ---------- Read BOT TOKEN ----------
let BOT_TOKEN = null;
// Prefer Render Secret File path /etc/secrets/<filename>
const SECRET_PATH = "/etc/secrets/bot_token.txt";
try {
  if (fs.existsSync(SECRET_PATH)) {
    BOT_TOKEN = fs.readFileSync(SECRET_PATH, "utf8").trim();
  }
} catch (e) {
  // ignore
}
// Fallback: environment variable BOT_TOKEN (if user set)
if (!BOT_TOKEN && process.env.BOT_TOKEN) BOT_TOKEN = String(process.env.BOT_TOKEN).trim();

if (!BOT_TOKEN) {
  console.error("❌ توکن ربات پیدا نشد! لطفاً bot_token.txt را به عنوان Secret File (یا متغیر محیطی BOT_TOKEN) اضافه کنید.");
  process.exit(1);
}

// ---------- Read WEBHOOK_URL ----------
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME || "";
if (!WEBHOOK_URL) {
  console.error("❌ WEBHOOK_URL پیدا نشد! در Settings سرویس Render متغیر محیطی WEBHOOK_URL را با آدرس https://your-app.onrender.com ست کنید.");
  process.exit(1);
}

// ---------- Create bot & express ----------
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ---------- Utility: bot as admin in channel? ----------
async function botIsAdminInChannel(channelId) {
  if (!channelId) return false;
  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(channelId, me.id);
    const status = member && member.status;
    return status === "administrator" || status === "creator";
  } catch (e) {
    // could fail for private channel or wrong id
    return false;
  }
}

// ---------- Utility: create one-time invite ----------
async function createOneTimeInvite() {
  if (!config.vipChannelId) return null;
  try {
    const ok = await botIsAdminInChannel(config.vipChannelId);
    if (!ok) return null;
    // createChatInviteLink - member_limit:1
    const res = await bot.telegram.createChatInviteLink(config.vipChannelId, { member_limit: 1 });
    // res may include invite_link or link
    return (res && (res.invite_link || res.link)) || null;
  } catch (e) {
    console.warn("createOneTimeInvite failed:", e.message || e);
    return null;
  }
}

// ---------- Handlers ----------

// /start
bot.start(async (ctx) => {
  try {
    const id = ctx.from.id;
    let user = findUserById(id);
    if (!user) {
      user = {
        id,
        first_name: ctx.from.first_name || "",
        last_name: ctx.from.last_name || "",
        username: ctx.from.username || "",
        phone: null,
        vipSent: false,
        joinedAt: new Date().toISOString()
      };
      users.push(user);
      saveUsers();
    } else {
      // update profile fields on each /start
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
      saveUsers();
    }

    // Welcome message (editable by admin)
    await ctx.reply(config.welcomeMessage || "سلام");

    // Request contact button (so user won't need to type)
    await ctx.reply("برای دریافت لینک VIP لطفاً شمارهٔ خود را با دکمه زیر ارسال کنید:", Markup.keyboard([
      Markup.button.contactRequest("ارسال شماره 📱")
    ]).oneTime().resize());
  } catch (e) {
    console.error("/start handler error:", e.message || e);
  }
});

// contact handler
bot.on("contact", async (ctx) => {
  try {
    const id = ctx.from.id;
    const contact = ctx.message.contact;
    if (!contact) return;

    // Validate contact belongs to sender (some clients include user_id)
    if (contact.user_id && String(contact.user_id) !== String(id)) {
      return ctx.reply("لطفاً شمارهٔ خود را از دکمهٔ ارسال شماره بفرستید.");
    }

    let user = findUserById(id);
    if (!user) {
      // in case start wasn't pressed
      user = {
        id,
        first_name: ctx.from.first_name || "",
        last_name: ctx.from.last_name || "",
        username: ctx.from.username || "",
        phone: contact.phone_number || null,
        vipSent: false,
        joinedAt: new Date().toISOString()
      };
      users.push(user);
    } else {
      user.phone = contact.phone_number || user.phone;
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
    }
    saveUsers();

    // send agreement inline button
    await ctx.reply(config.agreementText || "لطفاً توافقنامه را بپذیرید.", Markup.inlineKeyboard([
      Markup.button.callback(config.agreementButton || "تایید میکنم ✅", "AGREE_VIP")
    ]));
  } catch (e) {
    console.error("contact handler error:", e.message || e);
  }
});

// callback_query: agreement
bot.on("callback_query", async (ctx) => {
  try {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (!data) return ctx.answerCbQuery();

    const id = ctx.from.id;
    const user = findUserById(id);
    if (!user) {
      await ctx.reply("خطا: کاربر پیدا نشد. لطفاً ابتدا /start را بزنید.");
      return ctx.answerCbQuery();
    }

    if (data === "AGREE_VIP") {
      const userIsAdmin = isAdmin(id);
      if (user.vipSent && !userIsAdmin) {
        await ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید.");
        return ctx.answerCbQuery();
      }

      // Try to create one-time invite if possible
      let invite = null;
      if (config.vipChannelId) {
        invite = await createOneTimeInvite();
        if (!invite) {
          console.warn("One-time invite not available, falling back to vipChannelLink.");
        }
      }

      if (!invite) {
        // fallback to vipChannelLink (must be set in config by admin)
        invite = config.vipChannelLink || null;
      }

      if (!invite) {
        await ctx.reply("لطفاً از ادمین بخواهید لینک کانال را تنظیم کند (یا ربات را ادمین کانال کند).");
        return ctx.answerCbQuery();
      }

      // send invite
      await ctx.reply(`لینک VIP شما:\n${invite}`);

      // mark vipSent only for non-admins (admins can request unlimited)
      if (!userIsAdmin) {
        user.vipSent = true;
        saveUsers();
      }

      return ctx.answerCbQuery();
    }

    return ctx.answerCbQuery();
  } catch (e) {
    console.error("callback_query error:", e.message || e);
    try { await ctx.answerCbQuery("خطا"); } catch {}
  }
});

// /admin panel
bot.command("admin", async (ctx) => {
  try {
    const id = ctx.from.id;
    if (!isAdmin(id)) return ctx.reply("شما ادمین نیستید.");

    const menu = `پنل ادمین:
/listusers - نمایش کاربران
/listadmins - نمایش ادمین‌ها
/addadmin <id> - اضافه کردن ادمین
/removeadmin <id> - حذف ادمین
/setwelcome <متن> - تغییر پیام خوش‌آمد
/setagreement <متن> - تغییر متن توافقنامه
/setviplink <لینک> - تغییر لینک ثابت VIP
/setvipchannel <@channelusername> - تنظیم کانال برای لینک یک‌بارمصرف
`;
    return ctx.reply(menu);
  } catch (e) {
    console.error("/admin error:", e.message || e);
  }
});

// admin: listusers
bot.command("listusers", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    if (!users.length) return ctx.reply("هیچ کاربری ثبت نشده است.");

    const lines = users.map(u => `${u.id} | ${u.first_name || ""} ${u.last_name || ""} ${u.username ? "(" + "@" + u.username + ")" : ""}\n📱 ${u.phone || "-"} | joined: ${u.joinedAt || "-"} | vip:${u.vipSent ? "✅" : "❌"}`);
    const parts = chunkText(lines.join("\n\n"), 3500);
    for (const p of parts) await ctx.reply(p);
  } catch (e) {
    console.error("listusers error:", e.message || e);
    await ctx.reply("خطا هنگام خواندن لیست کاربران.");
  }
});

// admin: listadmins
bot.command("listadmins", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    if (!Array.isArray(config.admins) || !config.admins.length) return ctx.reply("هیچ ادمینی تنظیم نشده.");
    return ctx.reply("Admins:\n" + config.admins.join("\n"));
  } catch (e) {
    console.error("listadmins error:", e.message || e);
  }
});

// admin: addadmin <id>
bot.command("addadmin", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    const parts = ctx.message.text.split(" ").filter(Boolean);
    const id = parts[1] ? parts[1].trim() : null;
    if (!id) return ctx.reply("فرمت: /addadmin <user_id>");
    if (!config.admins.map(a => String(a)).includes(String(id))) {
      config.admins.push(Number(id));
      saveConfig();
      return ctx.reply(`ادمین با id ${id} اضافه شد.`);
    } else return ctx.reply("این شناسه قبلاً ادمین است.");
  } catch (e) {
    console.error("addadmin error:", e.message || e);
    return ctx.reply("خطا در افزودن ادمین.");
  }
});

// admin: removeadmin <id>
bot.command("removeadmin", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    const parts = ctx.message.text.split(" ").filter(Boolean);
    const id = parts[1] ? parts[1].trim() : null;
    if (!id) return ctx.reply("فرمت: /removeadmin <user_id>");
    config.admins = config.admins.filter(a => String(a) !== String(id));
    saveConfig();
    return ctx.reply(`ادمین ${id} حذف شد (اگر وجود داشت).`);
  } catch (e) {
    console.error("removeadmin error:", e.message || e);
    return ctx.reply("خطا در حذف ادمین.");
  }
});

// admin: setwelcome <text>
bot.command("setwelcome", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    const newText = ctx.message.text.replace("/setwelcome", "").trim();
    if (!newText) return ctx.reply("فرمت: /setwelcome متن جدید");
    config.welcomeMessage = newText;
    saveConfig();
    return ctx.reply("متن خوش‌آمد به‌روزرسانی شد.");
  } catch (e) {
    console.error("setwelcome error:", e.message || e);
    return ctx.reply("خطا در به‌روزرسانی پیام خوش‌آمد.");
  }
});

// admin: setagreement <text>
bot.command("setagreement", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    const newText = ctx.message.text.replace("/setagreement", "").trim();
    if (!newText) return ctx.reply("فرمت: /setagreement متن جدید");
    config.agreementText = newText;
    saveConfig();
    return ctx.reply("متن توافقنامه به‌روزرسانی شد.");
  } catch (e) {
    console.error("setagreement error:", e.message || e);
    return ctx.reply("خطا در به‌روزرسانی توافقنامه.");
  }
});

// admin: setviplink <link>
bot.command("setviplink", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    const newText = ctx.message.text.replace("/setviplink", "").trim();
    if (!newText) return ctx.reply("فرمت: /setviplink https://...");
    config.vipChannelLink = newText;
    saveConfig();
    return ctx.reply("لینک VIP ثابت (fallback) به‌روز شد.");
  } catch (e) {
    console.error("setviplink error:", e.message || e);
    return ctx.reply("خطا در ذخیره لینک VIP.");
  }
});

// admin: setvipchannel <@channelusername>
bot.command("setvipchannel", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید.");
    const newText = ctx.message.text.replace("/setvipchannel", "").trim();
    if (!newText) return ctx.reply("فرمت: /setvipchannel @channelusername");
    config.vipChannelId = newText;
    saveConfig();
    return ctx.reply("vipChannelId به‌روزرسانی شد (برای لینک یک‌بارمصرف).");
  } catch (e) {
    console.error("setvipchannel error:", e.message || e);
    return ctx.reply("خطا در ذخیره vipChannelId.");
  }
});

// ---------- Express webhook binding ----------
app.get("/", (req, res) => res.send("NEJJATEBOT is running"));
app.post("/bot", (req, res) => {
  // Telegraf expects full update object
  bot.handleUpdate(req.body)
    .then(() => res.sendStatus(200))
    .catch((err) => {
      console.error("handleUpdate error:", err);
      res.sendStatus(500);
    });
});

// ---------- Start server and set webhook ----------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, async () => {
  try {
    // try to remove old webhook to avoid conflicts
    await bot.telegram.deleteWebhook();
  } catch (e) {
    // ignore
  }
  const hook = `${WEBHOOK_URL.replace(/\/$/, "")}/bot`;
  try {
    await bot.telegram.setWebhook(hook);
    console.log("Webhook set to", hook);
  } catch (e) {
    console.error("Failed to set webhook:", e.message || e);
    process.exit(1);
  }

  console.log(`Server listening on port ${PORT}`);
  console.log("NEJJATEBOT ready (webhook mode).");
});

// ---------- Global error handling ----------
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
