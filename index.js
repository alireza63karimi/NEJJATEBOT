// index.js - NEJJATEBOT (Webhook + Express)
// نسخه نهایی: اصلاحات عملکردی، امنیتی و بهینه‌سازی IO

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const ROOT = __dirname;

// fetch compatibility (Node 18+ has global fetch). If not, dynamic import node-fetch.
let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    // dynamic import to avoid require issues in environments with native fetch
    fetchFn = (...args) => import('node-fetch').then(m => m.default(...args));
  } catch (e) {
    console.error('fetch not available and node-fetch import failed', e);
    process.exit(1);
  }
}
const fetch = (...args) => fetchFn(...args);

const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');

// --- Safe load and optimized save (avoid rewriting if unchanged) ---
function loadJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeJsonSync(file, fallback, { spaces: 2 });
      return fallback;
    }
    return fs.readJsonSync(file);
  } catch (e) {
    console.error('JSON load error', file, e && e.message);
    try { fs.writeJsonSync(file, fallback, { spaces: 2 }); } catch (_) {}
    return fallback;
  }
}

let config = loadJsonSafe(CONFIG_FILE, {
  welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
  agreementButton: "تایید میکنم ✅",
  vipChannelLink: "https://t.me/NEJJATE_VIP",
  admins: ["6043389836","188225902"],
  waitingFor: null,
  vipSendMode: "manual", // "manual" یا "auto"
  manualVipLinks: { current: "" }
});

let users = loadJsonSafe(USERS_FILE, {});

let lastConfigJSON = JSON.stringify(config);
let lastUsersJSON = JSON.stringify(users);

function saveConfig() {
  try {
    const s = JSON.stringify(config, null, 2);
    if (s !== lastConfigJSON) {
      fs.writeFileSync(CONFIG_FILE, s);
      lastConfigJSON = s;
    }
  } catch (e) { console.error('saveConfig error', e); }
}
function saveUsers() {
  try {
    const s = JSON.stringify(users, null, 2);
    if (s !== lastUsersJSON) {
      fs.writeFileSync(USERS_FILE, s);
      lastUsersJSON = s;
    }
  } catch (e) { console.error('saveUsers error', e); }
}

// --- Read BOT_TOKEN & WEBHOOK_URL (Render friendly) ---
let BOT_TOKEN = process.env.BOT_TOKEN || null;
const SECRET_PATH_RENDER = '/etc/secrets/bot_token.txt';
if (!BOT_TOKEN) {
  try {
    if (fs.existsSync(SECRET_PATH_RENDER)) {
      BOT_TOKEN = fs.readFileSync(SECRET_PATH_RENDER, 'utf8').trim();
    }
  } catch (e) { /* ignore */ }
}
if (!BOT_TOKEN) {
  const localTokenFile = path.join(ROOT, 'bot_token.txt');
  if (fs.existsSync(localTokenFile)) {
    try { BOT_TOKEN = fs.readFileSync(localTokenFile, 'utf8').trim(); } catch (e) {}
  }
}
if (!BOT_TOKEN && process.env.BOT_TOKEN) BOT_TOKEN = process.env.BOT_TOKEN.trim();

if (!BOT_TOKEN) {
  console.error('❌ توکن ربات پیدا نشد! لطفاً فایل secret با نام bot_token.txt در Render اضافه کن یا متغیر محیطی BOT_TOKEN را ست کن.');
  process.exit(1);
}

const TELEGRAM_API = (t) => `https://api.telegram.org/bot${t}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';

if (!WEBHOOK_URL) {
  console.warn('⚠️ متغیر محیطی WEBHOOK_URL تنظیم نشده. webhook خودکار ست نخواهد شد؛ لطفاً WEBHOOK_URL را ست کن.');
}

// --- Telegram helper ---
async function tg(method, body) {
  const url = `${TELEGRAM_API(BOT_TOKEN)}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await res.json();
    if (!j || !j.ok) {
      // log full response for debugging
      console.error('tg error', method, j);
    }
    return j;
  } catch (e) {
    console.error('tg fetch error', method, e && e.message);
    return null;
  }
}

// sendMessage wrapper
async function sendMessage(chat_id, text, extra = {}) {
  const payload = Object.assign({ chat_id: chat_id, text: String(text), parse_mode: 'HTML' }, extra);
  return await tg('sendMessage', payload);
}

// contact keyboard with requested label "اشتراک شماره تماس"
function contactKeyboard() {
  return {
    reply_markup: JSON.stringify({
      keyboard: [[{ text: "اشتراک شماره تماس", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    })
  };
}

// isAdmin check (compare strings)
function isAdmin(userId) {
  if (!userId) return false;
  const s = String(userId);
  return Array.isArray(config.admins) && config.admins.map(x => String(x)).includes(s);
}

// chunk text for long lists
function chunkText(text, n = 3000) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

// Utility: normalize username input (allow @username or id)
function normalizeAdminInput(input) {
  if (!input) return null;
  input = input.trim();
  if (/^\d+$/.test(input)) return input;
  if (input.startsWith('@')) return input;
  return null;
}

// --- VIP send logic (manual/auto) ---
async function sendVipLinkToUser(userId, chatId, callbackQueryId = null) {
  if (!users[userId]) {
    users[userId] = { id: userId, first_name: '', last_name: '', username: '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
  }

  // If not admin and already received => block
  if (users[userId].vipSent && !isAdmin(userId)) {
    if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text: '⚠️ شما قبلاً لینک را دریافت کرده‌اید.' });
    return { ok: false, reason: 'already_sent' };
  }

  const link = (config.vipSendMode === 'auto') ? config.vipChannelLink : (config.manualVipLinks && config.manualVipLinks.current ? config.manualVipLinks.current : null);

  if (!link) {
    if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text: '❌ لینک VIP هنوز توسط ادمین ثبت نشده است.' });
    return { ok: false, reason: 'no_link' };
  }

  await sendMessage(chatId, `🔗 لینک VIP شما:\n${link}`);
  if (!isAdmin(userId)) {
    users[userId].vipSent = true;
    saveUsers();
  }
  if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId });
  return { ok: true };
}

// --- Main update handler ---
async function handleUpdate(update) {
  try {
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const from = msg.from || {};
      const userId = String(from.id);

      // ensure user exists and refresh profile
      if (!users[userId]) {
        users[userId] = {
          id: userId,
          first_name: from.first_name || '',
          last_name: from.last_name || '',
          username: from.username || '',
          phone: '',
          vipSent: false,
          joinDate: new Date().toISOString()
        };
        saveUsers();
      } else {
        let changed = false;
        if (from.first_name && users[userId].first_name !== from.first_name) { users[userId].first_name = from.first_name; changed = true; }
        if (from.last_name && users[userId].last_name !== from.last_name) { users[userId].last_name = from.last_name; changed = true; }
        if (from.username && users[userId].username !== from.username) { users[userId].username = from.username; changed = true; }
        if (changed) saveUsers();
      }

      const text = (msg.text || '').trim();

      // if admin was in waitingFor mode and sends text, handle it
      if (isAdmin(userId) && config.waitingFor && config.waitingFor.by === userId && text) {
        const what = config.waitingFor.type;
        if (what === 'VIP') {
          config.vipChannelLink = text;
          config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ لینک VIP بروزرسانی شد.'); return;
        }
        if (what === 'WELCOME') {
          config.welcomeMessage = text;
          config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ پیام خوش‌آمد بروزرسانی شد.'); return;
        }
        if (what === 'AGREEMENT') {
          config.agreementText = text;
          config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ متن توافقنامه بروزرسانی شد.'); return;
        }
        if (what === 'ADDADMIN') {
          const candidate = normalizeAdminInput(text);
          let resolvedId = null;
          if (!candidate) {
            // try getChat if looks like @username
            if (text.startsWith('@')) {
              try {
                const g = await tg('getChat', { chat_id: text });
                if (g && g.ok && g.result && g.result.id) resolvedId = String(g.result.id);
              } catch (e) { resolvedId = null; }
            }
            if (!resolvedId) {
              config.waitingFor = null; saveConfig();
              await sendMessage(chatId, 'فرمت اشتباه. شناسه عددی یا @username وارد کنید.'); return;
            }
          } else {
            resolvedId = candidate;
            if (resolvedId.startsWith('@')) {
              // resolve username to id
              try {
                const g = await tg('getChat', { chat_id: resolvedId });
                if (g && g.ok && g.result && g.result.id) resolvedId = String(g.result.id);
              } catch (e) { /* ignore */ }
            }
          }
          if (!resolvedId) { config.waitingFor = null; saveConfig(); await sendMessage(chatId, '❌ شناسه معتبر نبود.'); return; }
          if (!config.admins.map(a=>String(a)).includes(resolvedId)) {
            config.admins.push(String(resolvedId)); saveConfig();
            config.waitingFor = null; await sendMessage(chatId, `✅ ادمین با id ${resolvedId} اضافه شد.`); return;
          } else {
            config.waitingFor = null; saveConfig(); await sendMessage(chatId, 'این شناسه قبلاً ادمین است.'); return;
          }
        }
        if (what === 'REMOVEADMIN') {
          const candidate = text.trim();
          if (!/^\d+$/.test(candidate)) { config.waitingFor = null; saveConfig(); await sendMessage(chatId, 'فرمت اشتباه است. لطفاً فقط user id را ارسال کن.'); return; }
          const idStr = String(candidate);
          if (!config.admins.map(a => String(a)).includes(idStr)) { config.waitingFor = null; saveConfig(); await sendMessage(chatId, 'این شناسه ادمین نیست.'); return; }
          config.admins = config.admins.filter(a => String(a) !== idStr); saveConfig();
          config.waitingFor = null; await sendMessage(chatId, `✅ ادمین با id ${idStr} حذف شد.`); return;
        }
      }

      // /start
      if (text === '/start') {
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, 'برای اشتراک شماره تماس، دکمه زیر را بزنید:', contactKeyboard());
        return;
      }

      // /ADMIN - admin panel
      if (text && text.toLowerCase() === '/admin') {
        if (!isAdmin(userId)) { await sendMessage(chatId, '⛔ شما ادمین نیستید.'); return; }
        const keyboard = {
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: '🔍 مشاهده خوش‌آمد', callback_data: 'ADMIN_VIEW_WELCOME' }, { text: '✏️ تغییر خوش‌آمد', callback_data: 'ADMIN_EDIT_WELCOME' }],
              [{ text: '🔍 مشاهده توافقنامه', callback_data: 'ADMIN_VIEW_AGREEMENT' }, { text: '✏️ تغییر توافقنامه', callback_data: 'ADMIN_EDIT_AGREEMENT' }],
              [{ text: '🔍 مشاهده لینک', callback_data: 'ADMIN_VIEW_VIP' }, { text: '✏️ تغییر لینک', callback_data: 'ADMIN_EDIT_VIP' }],
              [{ text: '👥 مشاهده ادمین‌ها', callback_data: 'ADMIN_VIEW_ADMINS' }, { text: '🧾 مشاهده کاربران', callback_data: 'ADMIN_LIST_USERS' }],
              [{ text: '➕ اضافه کردن ادمین', callback_data: 'ADMIN_ADD_ADMIN' }, { text: '➖ حذف ادمین', callback_data: 'ADMIN_REMOVE_ADMIN' }],
              [{ text: '🔁 لینک اتومات (ربات)', callback_data: 'VIP_MODE_AUTO' }, { text: '✋ لینک دستی (ادمین)', callback_data: 'VIP_MODE_MANUAL' }]
            ]
          })
        };
        await sendMessage(chatId, 'پنل مدیریت:', keyboard);
        return;
      }

      // contact message handling (when user presses contact button)
      if (msg.contact) {
        const contact = msg.contact;
        if (contact.user_id && String(contact.user_id) !== userId) {
          await sendMessage(chatId, 'لطفاً شمارهٔ خودتان را ارسال کنید (دکمه اشتراک شماره تماس را بزنید).');
          return;
        }
        // save phone
        users[userId].phone = contact.phone_number || '';
        saveUsers();
        // send agreement with inline button
        const inline = {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: config.agreementButton || 'تایید', callback_data: 'AGREE' }]]
          })
        };
        await sendMessage(chatId, config.agreementText || 'لطفاً توافقنامه را تایید کنید.', inline);
        return;
      }

      // other texts do nothing (or could be extended)
      return;
    }

    // callback_query handling
    if (update.callback_query) {
      const cb = update.callback_query;
      const from = cb.from || {};
      const userId = String(from.id);
      const data = cb.data;
      const chatId = cb.message && cb.message.chat ? cb.message.chat.id : null;

      // AGREE from user
      if (data === 'AGREE') {
        // ensure user record
        if (!users[userId]) {
          users[userId] = { id: userId, first_name: from.first_name || '', last_name: from.last_name || '', username: from.username || '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
          saveUsers();
        }
        await sendVipLinkToUser(userId, chatId, cb.id);
        return;
      }

      // Admin callbacks
      if (data && data.startsWith('ADMIN_') && isAdmin(userId)) {
        switch (data) {
          case 'ADMIN_VIEW_WELCOME':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, `پیام خوش‌آمد فعلی:\n\n${config.welcomeMessage}`);
            break;
          case 'ADMIN_EDIT_WELCOME':
            config.waitingFor = { type: 'WELCOME', by: userId }; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, 'لطفاً متن جدید خوش‌آمد را ارسال کنید (پیام).');
            break;
          case 'ADMIN_VIEW_AGREEMENT':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, `متن توافقنامه فعلی:\n\n${config.agreementText}`);
            break;
          case 'ADMIN_EDIT_AGREEMENT':
            config.waitingFor = { type: 'AGREEMENT', by: userId }; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, 'لطفاً متن جدید توافقنامه را ارسال کنید (پیام).');
            break;
          case 'ADMIN_VIEW_VIP':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, `لینک VIP فعلی:\n${config.vipChannelLink || 'تنظیم نشده'}`);
            break;
          case 'ADMIN_EDIT_VIP':
            config.waitingFor = { type: 'VIP', by: userId }; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, 'لطفاً لینک جدید VIP را ارسال کنید (پیام حاوی لینک).');
            break;
          case 'ADMIN_VIEW_ADMINS':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, `ادمین‌ها:\n\n${(config.admins && config.admins.length) ? config.admins.join('\n') : 'هیچ ادمینی ثبت نشده'}`);
            break;
          case 'ADMIN_LIST_USERS':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            const lines = Object.values(users).map(u => `${u.id} | ${u.first_name||''} ${u.last_name||''} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | vip:${u.vipSent ? '✅' : '❌'}`).join('\n');
            if (!lines) {
              await sendMessage(chatId, 'هیچ کاربری ثبت نشده.');
            } else {
              const parts = chunkText(lines, 3000);
              for (const p of parts) await sendMessage(chatId, p);
            }
            break;
          case 'ADMIN_ADD_ADMIN':
            config.waitingFor = { type: 'ADDADMIN', by: userId }; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, 'شناسهٔ عددی کاربر (user id) یا @username برای اضافه شدن به ادمین‌ها ارسال کن.');
            break;
          case 'ADMIN_REMOVE_ADMIN':
            config.waitingFor = { type: 'REMOVEADMIN', by: userId }; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, 'شناسهٔ عددی ادمینی که می‌خواهی حذف شود را ارسال کن.');
            break;
          case 'VIP_MODE_AUTO':
            config.vipSendMode = 'auto'; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ حالت VIP روی اتوماتیک تنظیم شد.' });
            break;
          case 'VIP_MODE_MANUAL':
            config.vipSendMode = 'manual'; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ حالت VIP روی دستی تنظیم شد.' });
            break;
          default:
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
        }
        return;
      }

      // if callback is admin-only but user not admin
      if (data && data.startsWith('ADMIN_') && !isAdmin(userId)) {
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '⛔ شما ادمین نیستید.' });
        return;
      }

      // fallback for other callbacks
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
    }
  } catch (err) {
    console.error('handleUpdate error', err && err.stack ? err.stack : err);
  }
}

// --- Express app + webhook ---
const app = express();
app.use(express.json({ limit: '200kb' }));

// webhook endpoint (validate token in path)
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  // Immediately ack 200
  res.sendStatus(200);
  // process update async (no blocking)
  try { await handleUpdate(req.body); } catch (e) { console.error('update processing failed', e); }
});

app.get('/', (req, res) => res.send('NEJJATEBOT running'));
app.get('/healthz', (req, res) => res.send('OK'));

// start server and set webhook (if WEBHOOK_URL provided)
const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(PORT, async () => {
  console.log(`Server running on port: ${PORT}`);
  if (!WEBHOOK_URL) {
    console.warn('WEBHOOK_URL not set - webhook will not be configured. Set WEBHOOK_URL env var to your public URL.');
    return;
  }
  const hook = `${WEBHOOK_URL.replace(/\/$/, '')}/webhook/${BOT_TOKEN}`;
  try {
    const res = await tg('setWebhook', { url: hook });
    if (res && res.ok) console.log('Webhook با موفقیت ست شد!');
    else console.warn('setWebhook response:', res);
  } catch (e) {
    console.error('Failed to set webhook:', e && (e.message || e));
  }
});
