// ============================================================================
// index.js - NEJJATEBOT Ultra-Final Render-Ready (2025)
// Node >=18 (global fetch included)
// ============================================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============================================================================
// PATHS
// ============================================================================
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');
const TOKEN_PATH = '/etc/secrets/bot_token.txt'; // Secret File

// ============================================================================
// LOAD BOT TOKEN
// ============================================================================
let BOT_TOKEN = null;
if (fs.existsSync(TOKEN_PATH)) {
  BOT_TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
}
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN پیدا نشد! مطمئن شوید Secret File درست است.");
  process.exit(1);
}
const API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

// ============================================================================
// JSON HELPERS
// ============================================================================
const loadJson = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  } catch {
    return fallback;
  }
};
const saveJson = (file, obj) => { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch {} };

// ============================================================================
// CONFIG & USERS
// ============================================================================
let config = loadJson(CONFIG_FILE, {
  welcomeMessage: "هم‌فرکانسی عزیز خوش آمدی 🌟 برای دریافت لینک VIP ابتدا شماره تماس را ارسال کن.",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم.",
  agreementButton: "تایید میکنم ✅",
  vipChannelId: null,
  vipSendMode: "auto",
  admins: ["6043389836", "188225902"],
  waitingFor: {},
  manualVipLinks: { current: null }
});
let users = loadJson(USERS_FILE, {});
const saveConfig = () => saveJson(CONFIG_FILE, config);
const saveUsers = () => saveJson(USERS_FILE, users);
const isAdmin = (uid) => config.admins.map(String).includes(String(uid));

// ============================================================================
// TELEGRAM HELPERS
// ============================================================================
async function tg(method, body) {
  try { 
    const res = await fetch(API(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); 
    return res.json(); 
  } catch (e) { console.error("tg error:", e.message); return null; }
}
async function sendMessage(chat_id, text, extra = {}) {
  try { return await tg("sendMessage", { chat_id, text: String(text), parse_mode: "HTML", ...extra }); }
  catch (e) { console.error("sendMessage error:", e.message); }
}
async function answerCallback(id, text = "") { if (!id) return; try { await tg("answerCallbackQuery", { callback_query_id: id, text }); } catch {} }

// ============================================================================
// KEYBOARDS
// ============================================================================
const contactKeyboard = () => ({
  reply_markup: JSON.stringify({ keyboard: [[{ text: "ارسال شماره تماس 📞", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true })
});
const adminInlineKeyboard = () => ({
  reply_markup: JSON.stringify({ inline_keyboard: [
    [{ text: "🔍 مشاهده خوش‌آمد", callback_data: "ADMIN_VIEW_WELCOME" }, { text: "✏️ تغییر خوش‌آمد", callback_data: "ADMIN_EDIT_WELCOME" }],
    [{ text: "🔍 مشاهده توافقنامه", callback_data: "ADMIN_VIEW_AGREEMENT" }, { text: "✏️ تغییر توافقنامه", callback_data: "ADMIN_EDIT_AGREEMENT" }],
    [{ text: "🔍 مشاهده لینک VIP", callback_data: "ADMIN_VIEW_VIP" }, { text: "✏️ تغییر لینک VIP", callback_data: "ADMIN_EDIT_VIP" }],
    [{ text: "👥 لیست ادمین‌ها", callback_data: "ADMIN_VIEW_ADMINS" }, { text: "🧾 لیست کاربران", callback_data: "ADMIN_LIST_USERS" }],
    [{ text: "➕ اضافه‌کردن ادمین", callback_data: "ADMIN_ADD_ADMIN" }, { text: "➖ حذف ادمین", callback_data: "ADMIN_REMOVE_ADMIN" }],
    [{ text: "🔁 حالت اتومات VIP", callback_data: "VIP_MODE_AUTO" }, { text: "✋ حالت دستی VIP", callback_data: "VIP_MODE_MANUAL" }]
  ]})
});

// ============================================================================
// INVITE QUEUE - Ultra Fast
// ============================================================================
const inviteQueue = [];
const inviteCache = new Map();
let activeWorkers = 0;
const MAX_WORKERS = 6;

async function resolveChannelId(input) {
  if (!input) return null;
  if (typeof input === "string" && input.startsWith("@")) { 
    const info = await tg("getChat", { chat_id: input }); 
    return info?.ok ? info.result.id : null; 
  }
  if (/^-?\d+$/.test(input)) return Number(input);
  return null;
}

async function createInvite(channel) {
  try {
    const chat_id = await resolveChannelId(channel);
    if (!chat_id) return { ok: false, error: "invalid_channel" };
    const expire_date = Math.floor(Date.now() / 1000) + 86400;
    const r = await tg("createChatInviteLink", { chat_id, member_limit: 1, expire_date });
    if (r?.ok) return { ok: true, link: r.result.invite_link };
    return { ok: false, error: r?.description };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function processInvite(task) {
  const { userId, chatId, callbackId, retries = 0 } = task;
  try {
    const cached = inviteCache.get(userId);
    if (cached && Date.now() < cached.expire) { await sendMessage(chatId, `🔗 لینک VIP شما:\n${cached.link}`); return; }
    const res = await createInvite(config.vipChannelId);
    if (res.ok) {
      inviteCache.set(userId, { link: res.link, expire: Date.now() + 30000 });
      await sendMessage(chatId, `🔗 لینک VIP شما:\n${res.link}`);
      users[userId].vipSent = true; saveUsers();
      await answerCallback(callbackId);
    } else {
      if (retries < 2) inviteQueue.push({ ...task, retries: retries + 1 });
      else {
        const fallback = config.manualVipLinks.current || "تنظیم نشده!";
        await sendMessage(chatId, `❌ خطا: ${res.error}\n🔗 لینک جایگزین:\n${fallback}`);
        await answerCallback(callbackId);
      }
    }
  } finally { activeWorkers--; scheduleQueue(); }
}

function scheduleQueue() {
  while (inviteQueue.length && activeWorkers < MAX_WORKERS) { activeWorkers++; processInvite(inviteQueue.shift()); }
}

// ============================================================================
// SEND VIP
// ============================================================================
async function sendVip(userId, chatId, callbackId = null) {
  users[userId] = users[userId] || {};
  if (users[userId].vipSent) { await answerCallback(callbackId, "قبلاً لینک را دریافت کرده‌اید."); return; }
  if (config.vipSendMode === "manual") {
    const link = config.manualVipLinks.current || "تنظیم نشده!";
    await sendMessage(chatId, `🔗 لینک VIP:\n${link}`);
    users[userId].vipSent = true; saveUsers(); return;
  }
  inviteQueue.push({ userId, chatId, callbackId }); scheduleQueue();
}

// ============================================================================
// EXPRESS + WEBHOOK
// ============================================================================
const app = express();
app.use(express.json({ limit: "200kb" }));
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;

app.post("/webhook", async (req, res) => {
  const update = req.body;
  if (!update) return res.sendStatus(200);
  if (WEBHOOK_SECRET && req.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) return res.sendStatus(403);
  res.sendStatus(200);

  try {
    // MESSAGE
    if (update.message) {
      const msg = update.message, chatId = msg.chat.id, from = msg.from, userId = String(from.id);
      users[userId] = users[userId] || { id:userId, first_name: from.first_name||"", username: from.username||"", phone:"", vipSent:false };
      saveUsers();

      if (msg.text === "/start") { 
        await sendMessage(chatId, config.welcomeMessage); 
        await sendMessage(chatId, "شماره تماس را ارسال کنید:", contactKeyboard()); 
        return; 
      }
      if (msg.text === "/admin") { 
        if (!isAdmin(userId)) return sendMessage(chatId, "⛔ دسترسی ندارید"); 
        return sendMessage(chatId, "پنل مدیریت:", adminInlineKeyboard()); 
      }

      if (msg.contact) { 
        users[userId].phone = msg.contact.phone_number; saveUsers(); 
        return sendMessage(chatId, config.agreementText, { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: config.agreementButton, callback_data: "AGREE" }]] }) }); 
      }

      if (config.waitingFor[userId] && msg.text) {
        const w = config.waitingFor[userId], val = msg.text.trim();
        if (w.type === "WELCOME") config.welcomeMessage = val;
        if (w.type === "AGREEMENT") config.agreementText = val;
        if (w.type === "VIP") config.manualVipLinks.current = val;
        delete config.waitingFor[userId]; saveConfig(); return sendMessage(chatId, "✅ ذخیره شد.");
      }
    }

    // CALLBACK QUERY
    if (update.callback_query) {
      const cb = update.callback_query, userId = String(cb.from.id), chatId = cb.message.chat.id, data = cb.data;
      if (data === "AGREE") { await answerCallback(cb.id); return sendVip(userId, chatId, cb.id); }

      if (data.startsWith("ADMIN_")) {
        if (!isAdmin(userId)) return answerCallback(cb.id, "⛔");
        const reply = (text) => sendMessage(chatId, text);
        switch(data) {
          case "ADMIN_VIEW_WELCOME": answerCallback(cb.id); reply("خوش‌آمد فعلی:\n"+config.welcomeMessage); break;
          case "ADMIN_EDIT_WELCOME": config.waitingFor[userId]={type:"WELCOME"}; saveConfig(); answerCallback(cb.id); reply("متن جدید را ارسال کن:"); break;
          case "ADMIN_VIEW_AGREEMENT": answerCallback(cb.id); reply(config.agreementText); break;
          case "ADMIN_EDIT_AGREEMENT": config.waitingFor[userId]={type:"AGREEMENT"}; saveConfig(); answerCallback(cb.id); reply("متن جدید توافقنامه را ارسال کن:"); break;
          case "ADMIN_VIEW_VIP": answerCallback(cb.id); reply(`VIP دستی:\n${config.manualVipLinks.current||"ندارد"}\n\nID اتومات:\n${config.vipChannelId||"ندارد"}`); break;
          case "ADMIN_EDIT_VIP": config.waitingFor[userId]={type:"VIP"}; saveConfig(); answerCallback(cb.id); reply("لینک جدید VIP را ارسال کن:"); break;
          case "ADMIN_VIEW_ADMINS": answerCallback(cb.id); reply("ادمین‌ها:\n"+config.admins.join("\n")); break;
          case "ADMIN_LIST_USERS": answerCallback(cb.id); reply(JSON.stringify(users,null,2)); break;
          case "VIP_MODE_AUTO": config.vipSendMode="auto"; saveConfig(); answerCallback(cb.id,"حالت روی اتومات قرار گرفت"); break;
          case "VIP_MODE_MANUAL": config.vipSendMode="manual"; saveConfig(); answerCallback(cb.id,"حالت روی دستی قرار گرفت"); break;
        }
      }
    }
  } catch(e){ console.error("Webhook error:", e.message); }
});

// ============================================================================
// START SERVER + SET WEBHOOK
// ============================================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  if (!WEBHOOK_URL) { console.error("❌ WEBHOOK_URL تنظیم نشده!"); return; }
  const body = { url: WEBHOOK_URL };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
  const res = await tg("setWebhook", body);
  console.log("setWebhook response:", res);
});
