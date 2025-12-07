// index.js - NEJJATEBOT (final, optimized)
// Requires Node >=18 (fetch is available)

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const ROOT = __dirname;

const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');

// fetch compatibility for environments without global fetch
let fetchFn = global.fetch;
if (!fetchFn) {
  try { fetchFn = (...args) => import('node-fetch').then(m => m.default(...args)); }
  catch (e) { console.error('fetch not available and node-fetch import failed', e); process.exit(1); }
}
const fetch = (...args) => fetchFn(...args);

// --- load/save helpers (minimize disk writes) ---
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
  // For manual mode we use vipChannelLink; for auto mode we need vipChannelId (id or @username of channel)
  vipChannelLink: "https://t.me/NEJJATE_VIP",
  vipChannelId: "@NEJJATE_VIP", // <-- set to channel username (or numeric id) where bot is admin
  admins: ["6043389836","188225902"],
  waitingFor: null,
  vipSendMode: "manual", // "manual" or "auto"
  manualVipLinks: { current: "" }
});

let users = loadJsonSafe(USERS_FILE, {});
let lastConfigJSON = JSON.stringify(config);
let lastUsersJSON = JSON.stringify(users);

function saveConfig() {
  try {
    const s = JSON.stringify(config, null, 2);
    if (s !== lastConfigJSON) { fs.writeFileSync(CONFIG_FILE, s); lastConfigJSON = s; }
  } catch (e) { console.error('saveConfig error', e); }
}
function saveUsers() {
  try {
    const s = JSON.stringify(users, null, 2);
    if (s !== lastUsersJSON) { fs.writeFileSync(USERS_FILE, s); lastUsersJSON = s; }
  } catch (e) { console.error('saveUsers error', e); }
}

// --- read BOT_TOKEN & WEBHOOK_URL (Render: secret file or env) ---
let BOT_TOKEN = process.env.BOT_TOKEN || null;
const SECRET_PATH_RENDER = '/etc/secrets/bot_token.txt';
if (!BOT_TOKEN && fs.existsSync(SECRET_PATH_RENDER)) {
  try { BOT_TOKEN = fs.readFileSync(SECRET_PATH_RENDER, 'utf8').trim(); } catch (e) {}
}
if (!BOT_TOKEN && fs.existsSync(path.join(ROOT, 'bot_token.txt'))) {
  try { BOT_TOKEN = fs.readFileSync(path.join(ROOT, 'bot_token.txt'), 'utf8').trim(); } catch (e) {}
}
if (!BOT_TOKEN && process.env.BOT_TOKEN) BOT_TOKEN = process.env.BOT_TOKEN.trim();

if (!BOT_TOKEN) { console.error('❌ توکن ربات پیدا نشد! قرار دادن bot_token.txt در Secrets Render یا متغیر محیطی BOT_TOKEN لازم است.'); process.exit(1); }

const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';

if (!WEBHOOK_URL) {
  console.warn('⚠️ WEBHOOK_URL تنظیم نشده است؛ webhook خودکار ست نخواهد شد. لطفاً WEBHOOK_URL را در Environment Variables قرار بده.');
}

// --- Telegram helpers ---
const TELEGRAM_API = (t) => `https://api.telegram.org/bot${t}`;

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
      // log for debugging (do not expose token)
      console.error(`tg ${method} returned error:`, j && j.description ? j.description : j);
    }
    return j;
  } catch (e) {
    console.error('tg fetch error', method, e && e.message);
    return null;
  }
}

async function sendMessage(chat_id, text, extra = {}) {
  const payload = Object.assign({ chat_id: chat_id, text: String(text), parse_mode: 'HTML' }, extra);
  return await tg('sendMessage', payload);
}

function contactKeyboard() {
  return {
    reply_markup: JSON.stringify({
      keyboard: [[{ text: "اشتراک شماره تماس", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    })
  };
}

function isAdmin(userId) {
  if (!userId) return false;
  const s = String(userId);
  return Array.isArray(config.admins) && config.admins.map(x => String(x)).includes(s);
}

function chunkText(text, n = 3000) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

// --- create single-use invite link via createChatInviteLink (auto mode) ---
// member_limit:1 => usable once; name includes user id for traceability.
async function createOneTimeInviteForUser(userId) {
  const chat_id = config.vipChannelId || config.vipChannelLink;
  if (!chat_id) return { ok: false, error: 'no_channel' };

  // name param optional
  const name = `invite_for_${userId}_${Date.now()}`;
  // member_limit:1 -> one-time usable link
  const payload = { chat_id, name, member_limit: 1 };

  const res = await tg('createChatInviteLink', payload);
  if (res && res.ok && res.result && res.result.invite_link) {
    return { ok: true, invite_link: res.result.invite_link };
  } else {
    return { ok: false, error: res && res.description ? res.description : 'create_failed' };
  }
}

// --- send VIP link logic (manual or auto) ---
async function sendVipLinkToUser(userId, chatId, callbackQueryId = null) {
  if (!users[userId]) {
    users[userId] = { id: userId, first_name: '', last_name: '', username: '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
  }

  if (users[userId].vipSent && !isAdmin(userId)) {
    if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text: '⚠️ شما قبلاً لینک را دریافت کرده‌اید.' });
    return { ok: false, reason: 'already_sent' };
  }

  if (config.vipSendMode === 'auto') {
    // auto: create one-time invite via API (bot must be admin of channel)
    const created = await createOneTimeInviteForUser(userId);
    if (!created.ok) {
      if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text: '❌ ساخت لینک یکبارمصرف با خطا مواجه شد؛ لطفاً با ادمین تماس بگیرید.' });
      console.error('createOneTimeInviteForUser error', created.error);
      return { ok: false, reason: 'create_failed' };
    }
    await sendMessage(chatId, `🔗 لینک VIP شما (یکبار مصرف):\n${created.invite_link}`);
  } else {
    // manual: send manualVipLinks.current or vipChannelLink
    const link = (config.manualVipLinks && config.manualVipLinks.current) ? config.manualVipLinks.current : config.vipChannelLink;
    if (!link) {
      if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text: '❌ لینک VIP هنوز توسط ادمین ثبت نشده است.' });
      return { ok: false, reason: 'no_link' };
    }
    await sendMessage(chatId, `🔗 لینک VIP شما:\n${link}`);
  }

  if (!isAdmin(userId)) { users[userId].vipSent = true; saveUsers(); }
  if (callbackQueryId) await tg('answerCallbackQuery', { callback_query_id: callbackQueryId });
  return { ok: true };
}

// --- main update handler ---
async function handleUpdate(update) {
  try {
    // MESSAGE
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const from = msg.from || {};
      const userId = String(from.id);

      // ensure user record and refresh name/username
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

      // If admin is in waitingFor and sent text, handle
      if (isAdmin(userId) && config.waitingFor && config.waitingFor.by === userId && text) {
        const what = config.waitingFor.type;
        if (what === 'VIP') { config.vipChannelLink = text; config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ لینک VIP بروزرسانی شد.'); return; }
        if (what === 'WELCOME') { config.welcomeMessage = text; config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ پیام خوش‌آمد بروزرسانی شد.'); return; }
        if (what === 'AGREEMENT') { config.agreementText = text; config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ متن توافقنامه بروزرسانی شد.'); return; }
        if (what === 'ADDADMIN') {
          // accept numeric id or @username -> try resolve username
          let candidate = text.trim();
          let newId = null;
          if (/^\d+$/.test(candidate)) newId = candidate;
          else if (candidate.startsWith('@')) {
            try {
              const res = await tg('getChat', { chat_id: candidate });
              if (res && res.ok && res.result && res.result.id) newId = String(res.result.id);
            } catch (e) { newId = null; }
          }
          config.waitingFor = null;
          if (!newId) { saveConfig(); await sendMessage(chatId, '❌ شناسهٔ معتبر نبود.'); return; }
          if (!config.admins.map(x => String(x)).includes(newId)) { config.admins.push(String(newId)); saveConfig(); await sendMessage(chatId, `✅ ادمین با id ${newId} اضافه شد.`); return; }
          else { saveConfig(); await sendMessage(chatId, 'این شناسه قبلاً ادمین است.'); return; }
        }
        if (what === 'REMOVEADMIN') {
          const candidate = text.trim();
          config.waitingFor = null;
          if (!/^\d+$/.test(candidate)) { saveConfig(); await sendMessage(chatId, 'فرمت اشتباه است. لطفاً فقط user id را ارسال کن.'); return; }
          const idStr = String(candidate);
          if (!config.admins.map(a => String(a)).includes(idStr)) { saveConfig(); await sendMessage(chatId, 'این شناسه ادمین نیست.'); return; }
          config.admins = config.admins.filter(a => String(a) !== idStr); saveConfig(); await sendMessage(chatId, `✅ ادمین با id ${idStr} حذف شد.`); return;
        }
      }

      // /start
      if (text === '/start') {
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, 'برای اشتراک شماره تماس، دکمه زیر را بزنید:', contactKeyboard());
        return;
      }

      // /admin
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

      // contact
      if (msg.contact) {
        const contact = msg.contact;
        if (contact.user_id && String(contact.user_id) !== userId) { await sendMessage(chatId, 'لطفاً شمارهٔ خودتان را ارسال کنید (دکمه اشتراک شماره تماس را بزنید).'); return; }
        users[userId].phone = contact.phone_number || '';
        saveUsers();
        const inline = { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: config.agreementButton || 'تایید', callback_data: 'AGREE' }]] }) };
        await sendMessage(chatId, config.agreementText || 'لطفاً توافقنامه را تایید کنید.', inline);
        return;
      }

      return;
    }

    // CALLBACK QUERY
    if (update.callback_query) {
      const cb = update.callback_query;
      const from = cb.from || {};
      const userId = String(from.id);
      const data = cb.data;
      const chatId = cb.message?.chat?.id || null;

      // AGREE
      if (data === 'AGREE') {
        if (!users[userId]) {
          users[userId] = { id: userId, first_name: from.first_name || '', last_name: from.last_name || '', username: from.username || '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
          saveUsers();
        }
        await sendVipLinkToUser(userId, chatId, cb.id);
        return;
      }

      // Admin callbacks
      if (data?.startsWith('ADMIN_') && isAdmin(userId)) {
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
            await sendMessage(chatId, `لینک دستی VIP:\n${(config.manualVipLinks && config.manualVipLinks.current) ? config.manualVipLinks.current : (config.vipChannelLink || 'تنظیم نشده')}\n\nکانال (برای لینک اتومات): ${config.vipChannelId || 'تنظیم نشده'}`);
            break;
          case 'ADMIN_EDIT_VIP':
            config.waitingFor = { type: 'VIP', by: userId }; saveConfig();
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, 'لطفاً لینک جدید VIP (یا آدرس کانال برای اتومات) را ارسال کنید (پیام).');
            break;
          case 'ADMIN_VIEW_ADMINS':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            await sendMessage(chatId, `ادمین‌ها:\n\n${(config.admins && config.admins.length) ? config.admins.join('\n') : 'هیچ ادمینی ثبت نشده'}`);
            break;
          case 'ADMIN_LIST_USERS':
            await tg('answerCallbackQuery', { callback_query_id: cb.id });
            const lines = Object.values(users).map(u => `${u.id} | ${u.first_name||''} ${u.last_name||''} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | vip:${u.vipSent ? '✅' : '❌'}`).join('\n');
            if (!lines) { await sendMessage(chatId, 'هیچ کاربری ثبت نشده.'); }
            else {
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

      // admin-only callback attempted by non-admin
      if (data?.startsWith('ADMIN_') && !isAdmin(userId)) {
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '⛔ شما ادمین نیستید.' });
        return;
      }

      // fallback
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
    }
  } catch (err) {
    console.error('handleUpdate error', err && (err.stack || err.message || err));
  }
}

// --- Express + webhook ---
const app = express();
app.use(express.json({ limit: '200kb' }));

// webhook endpoint
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  res.sendStatus(200); // ack quickly
  try { await handleUpdate(req.body); } catch (e) { console.error('update processing failed', e && e.message); }
});

app.get('/', (req, res) => res.send('NEJJATEBOT running'));
app.get('/healthz', (req, res) => res.send('OK'));

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
  } catch (e) { console.error('Failed to set webhook:', e && (e.message || e)); }
});
