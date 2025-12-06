/**
 * NEJJATEBOT - index.js (Final)
 * - Polling mode (bot.launch)
 * - Token loaded from bot_token.txt (Render secret file)
 * - Files: config.json, users.json
 * - Admins can be added/removed by id or @username (if username exists in users.json)
 */

const { Telegraf, Markup } = require("telegraf");
const fs = require("fs-extra");
const path = require("path");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, "bot_token.txt");
const CONFIG_FILE = path.join(ROOT, "config.json");
const USERS_FILE = path.join(ROOT, "users.json");

// --- load token ---
if (!fs.pathExistsSync(TOKEN_FILE)) {
  console.error("Missing bot_token.txt — put your bot token (single line) in bot_token.txt");
  process.exit(1);
}
const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
if (!token) {
  console.error("Empty token in bot_token.txt");
  process.exit(1);
}
const bot = new Telegraf(token);

// --- default config ---
let config = {
  admins: [], // numeric ids
  welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
  agreementButton: "تایید میکنم ✅",
  vipPrivateLink: "https://t.me/NEJJATE_VIP",
  pending: null // used for admin edit flows
};

// --- load config safely ---
try {
  if (fs.pathExistsSync(CONFIG_FILE)) {
    const c = fs.readJsonSync(CONFIG_FILE);
    config = { ...config, ...c };
    // normalize admin IDs to Number
    if (!Array.isArray(config.admins)) config.admins = [];
    config.admins = config.admins.map(x => Number(x));
  } else {
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  }
} catch (e) {
  console.error("Failed to read/write config.json:", e.message);
  process.exit(1);
}

// --- load users safely ---
let users = [];
try {
  if (fs.pathExistsSync(USERS_FILE)) {
    const u = fs.readJsonSync(USERS_FILE);
    if (Array.isArray(u)) users = u;
    else fs.writeJsonSync(USERS_FILE, []);
  } else {
    fs.writeJsonSync(USERS_FILE, []);
  }
} catch (e) {
  console.warn("Failed to read/write users.json:", e.message);
  users = [];
  fs.writeJsonSync(USERS_FILE, users, { spaces: 2 });
}

function saveUsers() {
  try {
    fs.writeJsonSync(USERS_FILE + ".tmp", users, { spaces: 2 });
    fs.moveSync(USERS_FILE + ".tmp", USERS_FILE, { overwrite: true });
  } catch (e) {
    console.error("Failed to save users.json:", e.message);
  }
}
function saveConfig() {
  try {
    fs.writeJsonSync(CONFIG_FILE + ".tmp", config, { spaces: 2 });
    fs.moveSync(CONFIG_FILE + ".tmp", CONFIG_FILE, { overwrite: true });
  } catch (e) {
    console.error("Failed to save config.json:", e.message);
  }
}

function isAdmin(id) {
  return Array.isArray(config.admins) && config.admins.includes(Number(id));
}
function findUserById(id) {
  return users.find(u => Number(u.id) === Number(id));
}
function findUserByUsername(username) {
  if (!username) return null;
  const clean = username.replace(/^@/, "").toLowerCase();
  return users.find(u => (u.username || "").toLowerCase() === clean);
}

// ---------------- START ----------------
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = findUserById(userId);
    if (!user) {
      user = {
        id: userId,
        fullname: null,
        username: ctx.from.username || "",
        phone: null,
        agreed: false,
        invited: false,
        step: "ask_fullname",
        joinDate: new Date().toISOString()
      };
      users.push(user);
      saveUsers();
    } else {
      // update username if changed
      user.username = ctx.from.username || user.username;
      saveUsers();
    }

    await ctx.reply(config.welcomeMessage);
    await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
  } catch (e) {
    console.error("/start error:", e.message);
  }
});

// ---------------- ADMIN PENDING HANDLER (runs first for admin edits) ----------------
bot.on("text", async (ctx, next) => {
  try {
    const pending = config.pending; // "welcome" | "agreement" | "vip" | "add_admin" | "remove_admin" | null
    if (!pending) return next();

    // only admins can complete pending actions
    if (!isAdmin(ctx.from.id)) return next();

    const txt = String(ctx.message.text || "").trim();
    if (!txt) {
      await ctx.reply("متن نامعتبر است؛ مجدداً ارسال کنید.");
      return;
    }

    if (pending === "welcome") {
      config.welcomeMessage = txt;
      await ctx.reply("پیام خوش‌آمد ذخیره شد.");
    } else if (pending === "agreement") {
      config.agreementText = txt;
      await ctx.reply("متن توافقنامه ذخیره شد.");
    } else if (pending === "vip") {
      config.vipPrivateLink = txt;
      await ctx.reply("لینک VIP ذخیره شد.");
    } else if (pending === "add_admin") {
      // accept numeric id or @username
      let targetId = null;
      if (/^\d+$/.test(txt)) {
        targetId = Number(txt);
      } else {
        const found = findUserByUsername(txt);
        if (found) targetId = Number(found.id);
      }
      if (!targetId) {
        await ctx.reply("شناسه یا یوزرنیم در لیست کاربران پیدا نشد. لطفاً شناسه (numeric id) ارسال کنید یا ابتدا کاربر را استارت کرده باشد.");
      } else {
        if (!config.admins.includes(targetId)) {
          config.admins.push(targetId);
          saveConfig();
          await ctx.reply(`ادمین با آیدی ${targetId} اضافه شد.`);
        } else {
          await ctx.reply("این کاربر از قبل ادمین است.");
        }
      }
    } else if (pending === "remove_admin") {
      let targetId = null;
      if (/^\d+$/.test(txt)) {
        targetId = Number(txt);
      } else {
        const found = findUserByUsername(txt);
        if (found) targetId = Number(found.id);
      }
      if (!targetId) {
        await ctx.reply("شناسه یا یوزرنیم در لیست کاربران پیدا نشد.");
      } else {
        config.admins = config.admins.filter(a => Number(a) !== Number(targetId));
        saveConfig();
        await ctx.reply(`ادمین با آیدی ${targetId} حذف شد (اگر وجود داشت).`);
      }
    }

    config.pending = null;
    saveConfig();
    return; // consume
  } catch (e) {
    console.error("admin pending handler error:", e.message);
    return next();
  }
});

// ---------------- USER FLOW: fullname -> contact -> agreement ----------------
bot.on("text", async (ctx, next) => {
  try {
    const userId = ctx.from.id;
    const user = findUserById(userId);
    if (!user) return next();

    // if user in ask_fullname
    if (user.step === "ask_fullname") {
      const txt = String(ctx.message.text || "").trim();
      if (!txt) return ctx.reply("نام و نام خانوادگی معتبر نیست؛ لطفاً دوباره ارسال کنید.");
      user.fullname = txt;
      user.step = "ask_phone";
      // update username too
      user.username = ctx.from.username || user.username;
      saveUsers();
      return ctx.reply(
        "شمارهٔ خود را از دکمه زیر ارسال کنید:",
        Markup.keyboard([Markup.button.contactRequest("ارسال شماره 📱")]).oneTime().resize()
      );
    }

    if (user.step === "agreement") {
      return ctx.reply("لطفاً روی دکمه تایید کردن توافقنامه بزنید.");
    }

    return next();
  } catch (e) {
    console.error("user text handler error:", e.message);
    return next();
  }
});

// CONTACT handler
bot.on("contact", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const contact = ctx.message.contact;
    if (!contact) return;
    // validate contact belongs to sender if user_id provided
    if (contact.user_id && Number(contact.user_id) !== Number(userId)) {
      return ctx.reply("لطفاً شمارهٔ خودتان را ارسال کنید (با دکمه ارسال شماره).");
    }

    let user = findUserById(userId);
    if (!user) {
      // fallback: if user didn't /start, create minimal record
      user = {
        id: userId,
        fullname: ctx.from.first_name || "",
        username: ctx.from.username || "",
        phone: contact.phone_number || "",
        agreed: false,
        invited: false,
        step: "agreement",
        joinDate: new Date().toISOString()
      };
      users.push(user);
    } else {
      user.phone = contact.phone_number || user.phone;
      user.step = "agreement";
      user.username = ctx.from.username || user.username;
    }
    saveUsers();

    await ctx.reply(
      config.agreementText,
      Markup.inlineKeyboard([Markup.button.callback(config.agreementButton, "AGREE_VIP")])
    );
  } catch (e) {
    console.error("contact handler error:", e.message);
  }
});

// AGREEMENT action -> send VIP link
bot.action("AGREE_VIP", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = findUserById(userId);
    if (!user) {
      await ctx.reply("خطا: کاربر پیدا نشد. لطفاً /start بزنید.");
      return ctx.answerCbQuery();
    }

    const admin = isAdmin(userId);

    if (!admin && user.invited) {
      await ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید 🌟");
      return ctx.answerCbQuery();
    }

    const link = config.vipPrivateLink;
    if (!link) {
      await ctx.reply("لینک VIP تنظیم نشده است. لطفاً با ادمین تماس بگیرید.");
      return ctx.answerCbQuery();
    }

    // mark user as invited only if not admin
    if (!admin) {
      user.invited = true;
      saveUsers();
    }

    await ctx.reply(`این هم لینک ورود شما به کانال VIP:\n\n${link}`);
    return ctx.answerCbQuery();
  } catch (e) {
    console.error("AGREE_VIP error:", e.message);
    try { await ctx.answerCbQuery("خطا"); } catch {}
  }
});

// ---------------- ADMIN DASHBOARD (/admin) ----------------
bot.command("admin", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply("شما ادمین نیستید ❌");

    await ctx.reply(
      "پنل ادمین — انتخاب کنید:",
      Markup.inlineKeyboard([
        [Markup.button.callback("مشاهده کاربران", "SHOW_USERS")],
        [Markup.button.callback("تغییر پیام خوش‌آمد", "EDIT_WELCOME"), Markup.button.callback("تغییر توافقنامه", "EDIT_AGREEMENT")],
        [Markup.button.callback("تغییر لینک VIP", "EDIT_VIP")],
        [Markup.button.callback("اضافه کردن ادمین", "ADD_ADMIN"), Markup.button.callback("حذف ادمین", "REMOVE_ADMIN")]
      ])
    );
  } catch (e) {
    console.error("/admin error:", e.message);
  }
});

// admin actions
bot.action("SHOW_USERS", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("دسترسی ندارید");
    await ctx.answerCbQuery();
    if (!users || users.length === 0) return ctx.reply("هیچ کاربری ثبت نشده.");
    let text = "لیست کاربران:\n\n";
    for (const u of users) {
      text += `👤 ${u.fullname || "-"}\n@${u.username || "-"}\n📱 ${u.phone || "-"}\n🆔 ${u.id}\nvip: ${u.invited ? "✅" : "❌"}\n────────\n`;
    }
    // chunk long message
    for (let i = 0; i < text.length; i += 3500) await ctx.reply(text.slice(i, i + 3500));
  } catch (e) {
    console.error("SHOW_USERS error:", e.message);
  }
});

bot.action("EDIT_WELCOME", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("دسترسی ندارید");
  config.pending = "welcome";
  saveConfig();
  await ctx.answerCbQuery();
  await ctx.reply("متن جدید پیام خوش‌آمد را ارسال کنید:");
});
bot.action("EDIT_AGREEMENT", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("دسترسی ندارید");
  config.pending = "agreement";
  saveConfig();
  await ctx.answerCbQuery();
  await ctx.reply("متن جدید توافقنامه را ارسال کنید:");
});
bot.action("EDIT_VIP", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("دسترسی ندارید");
  config.pending = "vip";
  saveConfig();
  await ctx.answerCbQuery();
  await ctx.reply("لینک جدید VIP را ارسال کنید (مثال: https://t.me/+XXXX):");
});
bot.action("ADD_ADMIN", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("دسترسی ندارید");
  config.pending = "add_admin";
  saveConfig();
  await ctx.answerCbQuery();
  await ctx.reply("شناسه یا یوزرنیم (مثلاً @username یا numeric id) کاربری را ارسال کنید تا ادمین شود:");
});
bot.action("REMOVE_ADMIN", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("دسترسی ندارید");
  config.pending = "remove_admin";
  saveConfig();
  await ctx.answerCbQuery();
  await ctx.reply("شناسه یا یوزرنیم کاربری را ارسال کنید تا از ادمین‌ها حذف شود:");
});

// fallback quick commands for admins
bot.command("listusers", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید");
  if (!users || users.length === 0) return ctx.reply("هیچ کاربری ثبت نشده.");
  let text = "لیست کاربران:\n\n";
  for (const u of users) {
    text += `👤 ${u.fullname || "-"}\n@${u.username || "-"}\n📱 ${u.phone || "-"}\n🆔 ${u.id}\nvip: ${u.invited ? "✅" : "❌"}\n────────\n`;
  }
  for (let i = 0; i < text.length; i += 3500) await ctx.reply(text.slice(i, i + 3500));
});

bot.command("addadmin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید");
  const parts = ctx.message.text.split(" ").filter(Boolean);
  if (!parts[1]) return ctx.reply("فرمت: /addadmin <user_id or @username>");
  const arg = parts[1].trim();
  let target = null;
  if (/^\d+$/.test(arg)) target = Number(arg);
  else {
    const found = findUserByUsername(arg);
    if (found) target = Number(found.id);
  }
  if (!target) return ctx.reply("کاربر پیدا نشد در users.json. ابتدا کاربر را استارت کند یا آیدی مستقیم بدهید.");
  if (!config.admins.includes(target)) {
    config.admins.push(target);
    saveConfig();
    return ctx.reply(`ادمین با آیدی ${target} اضافه شد.`);
  }
  return ctx.reply("این کاربر از قبل ادمین است.");
});

bot.command("removeadmin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("دسترسی ندارید");
  const parts = ctx.message.text.split(" ").filter(Boolean);
  if (!parts[1]) return ctx.reply("فرمت: /removeadmin <user_id or @username>");
  const arg = parts[1].trim();
  let target = null;
  if (/^\d+$/.test(arg)) target = Number(arg);
  else {
    const found = findUserByUsername(arg);
    if (found) target = Number(found.id);
  }
  if (!target) return ctx.reply("کاربر پیدا نشد در users.json.");
  config.admins = config.admins.filter(a => Number(a) !== Number(target));
  saveConfig();
  return ctx.reply(`ادمین با آیدی ${target} حذف شد (اگر وجود داشت).`);
});

// ---------------- Launch bot (Polling) ----------------
bot.launch().then(() => console.log("NEJJATEBOT running (polling)")).catch(err => {
  console.error("Failed to launch bot:", err);
  process.exit(1);
});

// graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// logs
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
