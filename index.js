// index.js - NEJJATEBOT Ultimate Ultra-Fast Full Admin Panel v2025 (final)
// Node >=18 (global fetch)

const express = require('express');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');
const TOKEN_PATH = '/etc/secrets/bot_token.txt';

// ---------- Bot Token ----------
let BOT_TOKEN = process.env.BOT_TOKEN || (fs.existsSync(TOKEN_PATH) ? fs.readFileSync(TOKEN_PATH, 'utf8').trim() : null);
if (!BOT_TOKEN) {
  console.error('❌ Bot token not found (env BOT_TOKEN or secret file bot_token.txt required)');
  process.exit(1);
}
const TELEGRAM_API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

// ---------- JSON Utils ----------
function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const txt = fs.readFileSync(file, 'utf8');
    return JSON.parse(txt || JSON.stringify(fallback));
  } catch (e) {
    try { fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); } catch (_) {}
    return fallback;
  }
}
function saveJsonIfChanged(file, obj, lastRef) {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s !== lastRef.value) {
      fs.writeFileSync(file, s);
      lastRef.value = s;
    }
  } catch (e) { console.error('saveJson error', file, e?.message); }
}

// ---------- Config / Users ----------
let config = loadJson(CONFIG_FILE, {
  welcomeMessage: `هم فرکانسی عزیز خوش آمدی!
برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید.`,
  agreementText: `من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم`,
  agreementButton: 'تایید میکنم ✅',
  vipChannelLink: 'https://t.me/NEJJATE_VIP', // fallback
  vipChannelId: null, // numeric id or @username
  vipSendMode: 'auto', // auto/manual
  admins: ['6043389836', '188225902'],
  waitingFor: {},
  manualVipLinks: { current: null }
});
let users = loadJson(USERS_FILE, {});
const lastConfigJSON = { value: JSON.stringify(config, null, 2) };
const lastUsersJSON = { value: JSON.stringify(users, null, 2) };
function saveConfig() { saveJsonIfChanged(CONFIG_FILE, config, lastConfigJSON); }
function saveUsers() { saveJsonIfChanged(USERS_FILE, users, lastUsersJSON); }

function isAdmin(uid) { return uid && Array.isArray(config.admins) && config.admins.map(x => String(x)).includes(String(uid)); }
function chunkText(text, n = 4000) { const out = []; for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n)); return out; }

// ---------- Telegram helpers ----------
async function tg(method, body) {
  try {
    const res = await fetch(TELEGRAM_API(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await res.json();
    if (!j || !j.ok) console.error('tg error', method, j?.description || j);
    return j;
  } catch (e) { console.error('tg fetch failed', method, e?.message); return null; }
}

async function sendMessage(chat_id, text, extra = {}) {
  try { return await tg('sendMessage', Object.assign({ chat_id, text: String(text), parse_mode: 'HTML' }, extra)); }
  catch (e) { console.error('sendMessage error', e?.message); }
}

async function safeAnswerCallback(cb_id, text = '') {
  if (!cb_id) return;
  try { await tg('answerCallbackQuery', { callback_query_id: cb_id, text }); } catch (e) { }
}

// ---------- Keyboards ----------
function contactKeyboard() {
  return {
    reply_markup: JSON.stringify({
      keyboard: [[{ text: "اشتراک شماره تماس", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    })
  };
}

function adminInlineKeyboard() {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '🔍 مشاهده خوش‌آمد', callback_data: 'ADMIN_VIEW_WELCOME' }, { text: '✏️ تغییر خوش‌آمد', callback_data: 'ADMIN_EDIT_WELCOME' }],
        [{ text: '🔍 مشاهده توافقنامه', callback_data: 'ADMIN_VIEW_AGREEMENT' }, { text: '✏️ تغییر توافقنامه', callback_data: 'ADMIN_EDIT_AGREEMENT' }],
        [{ text: '🔍 مشاهده لینک', callback_data: 'ADMIN_VIEW_VIP' }, { text: '✏️ تغییر لینک', callback_data: 'ADMIN_EDIT_VIP' }],
        [{ text: '👥 مشاهده ادمین‌ها', callback_data: 'ADMIN_VIEW_ADMINS' }, { text: '🧾 مشاهده کاربران', callback_data: 'ADMIN_LIST_USERS' }],
        [{ text: '➕ اضافه کردن ادمین', callback_data: 'ADMIN_ADD_ADMIN' }, { text: '➖ حذف ادمین', callback_data: 'ADMIN_REMOVE_ADMIN' }],
        [{ text: '🔁 لینک اتومات (یکبار مصرف)', callback_data: 'VIP_MODE_AUTO' }, { text: '✋ لینک دستی', callback_data: 'VIP_MODE_MANUAL' }]
      ]
    })
  };
}

// ---------- Invite Queue ----------
const inviteQueue = [];
const inviteCache = new Map();
let activeWorkers = 0;
const MAX_WORKERS = 6;

async function createInviteForChannel(channelIdentifier) {
  if (!channelIdentifier) return { ok: false, error: 'no_channel' };
  if (typeof channelIdentifier === 'string' && channelIdentifier.includes('t.me/+')) return { ok: false, error: 'private_link_no_id' };

  let chat_id = channelIdentifier;
  if (typeof chat_id === 'string' && chat_id.startsWith('@')) {
    const info = await tg('getChat', { chat_id });
    if (!info || !info.ok) return { ok: false, error: 'getchat_failed' };
    chat_id = info.result.id;
  }

  const expire_date = Math.floor(Date.now() / 1000) + 86400;
  const res = await tg('createChatInviteLink', { chat_id, member_limit: 1, expire_date, creates_join_request: false });
  if (res && res.ok && res.result && res.result.invite_link) return { ok: true, link: res.result.invite_link, expiresAt: expire_date * 1000 };
  return { ok: false, error: res?.description || 'create_failed' };
}

async function createInvite(userId) {
  const cached = inviteCache.get(userId);
  if (cached && Date.now() < cached.cacheExpiresAt) return { ok: true, link: cached.link, expiresAt: cached.expiresAt };

  const channelId = config.vipChannelId;
  const result = await createInviteForChannel(channelId);
  if (result.ok) {
    inviteCache.set(userId, { link: result.link, expiresAt: result.expiresAt, cacheExpiresAt: Date.now() + 30 * 1000 });
    return { ok: true, link: result.link, expiresAt: result.expiresAt };
  }
  return result;
}

async function processQueueTask(task) {
  const { userId, chatId, callbackId, retries = 0 } = task;
  try {
    const res = await createInvite(userId);
    if (res.ok) {
      await sendMessage(chatId, `🔗 لینک VIP شما (یکبار مصرف — قابل استفاده یک‌بار تا 24 ساعت):\n${res.link}`);
      users[userId].vipSent = true; saveUsers();
      if (callbackId) await safeAnswerCallback(callbackId);
    } else {
      if (res.error === 'private_link_no_id') {
        const fallback = config.manualVipLinks?.current || config.vipChannelLink;
        await sendMessage(chatId, `⚠️ کانال با شناسه معتبر تنظیم نشده؛ لینک جایگزین:\n${fallback}`);
        if (callbackId) await safeAnswerCallback(callbackId);
        if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
      } else if (retries < 2) inviteQueue.push({ userId, chatId, callbackId, retries: retries + 1 });
      else {
        const fallback = config.manualVipLinks?.current || config.vipChannelLink;
        await sendMessage(chatId, `❌ خطا در ساخت لینک یکبارمصرف (${res.error}).\nلینک جایگزین:\n${fallback}`);
        if (callbackId) await safeAnswerCallback(callbackId);
        if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
      }
    }
  } catch (e) {
    if (task.retries < 2) inviteQueue.push({ userId, chatId, callbackId, retries: (task.retries || 0) + 1 });
    else {
      const fallback = config.manualVipLinks?.current || config.vipChannelLink;
      await sendMessage(chatId, `❌ خطای داخلی در ساخت لینک. لینک جایگزین:\n${fallback}`);
      if (callbackId) await safeAnswerCallback(callbackId);
      if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
    }
  } finally {
    activeWorkers = Math.max(0, activeWorkers - 1);
    scheduleQueue();
  }
}

function scheduleQueue() {
  while (inviteQueue.length > 0 && activeWorkers < MAX_WORKERS) {
    const task = inviteQueue.shift();
    if (!task) break;
    activeWorkers++;
    processQueueTask(task);
  }
}

// ---------- Send VIP ----------
async function sendVipLinkToUser(userId, chatId, callbackId = null) {
  if (!users[userId]) { 
    users[userId] = { id: userId, first_name: '', last_name: '', username: '', phone: '', vipSent: false, joinDate: new Date().toISOString() }; 
    saveUsers(); 
  }
  if (users[userId].vipSent && !isAdmin(userId)) {
    if (callbackId) await safeAnswerCallback(callbackId, '⚠️ شما قبلاً لینک را دریافت کرده‌اید.');
    return { ok: false, reason: 'already_sent' };
  }

  if (config.vipSendMode === 'auto') {
    if (!config.vipChannelId) {
      const fallback = config.manualVipLinks?.current || config.vipChannelLink;
      if (callbackId) await safeAnswerCallback(callbackId, '❌ کانال برای حالت اتومات تنظیم نشده. لینک دستی ارسال می‌شود.');
      await sendMessage(chatId, `🔗 لینک VIP شما:\n${fallback}`);
      if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
      return { ok: false, reason: 'no_channel_id' };
    }
    inviteQueue.push({ userId, chatId, callbackId });
    scheduleQueue();
    return { ok: true, queued: true };
  } else {
    const link = config.manualVipLinks?.current || config.vipChannelLink;
    await sendMessage(chatId, `🔗 لینک VIP شما:\n${link}`);
    if (callbackId) await safeAnswerCallback(callbackId);
    if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
    return { ok: true };
  }
}

// ---------- Express webhook ----------
const app = express();
app.use(express.json({ limit: '200kb' }));
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (!update) return res.send({ ok: false, message: 'no update' });

    if (WEBHOOK_SECRET) {
      const h = req.get('x-telegram-bot-api-secret-token');
      if (!h || h !== WEBHOOK_SECRET) return res.send({ ok: false, message: 'unauthorized' });
    }

    // ack
    res.sendStatus(200);

    // -------- message handling ----------
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat?.id;
      const from = msg.from || {};
      if (!chatId || !from.id) return;

      const userId = String(from.id);
      if (!users[userId]) { 
        users[userId] = { id: userId, first_name: from.first_name || '', last_name: from.last_name || '', username: from.username || '', phone: '', vipSent: false, joinDate: new Date().toISOString() }; 
        saveUsers(); 
      }

      // Forwarded channel message by admin
      if (msg.forward_from_chat && isAdmin(userId)) {
        const ch = msg.forward_from_chat;
        config.vipChannelId = ch.username ? `@${ch.username}` : String(ch.id);
        saveConfig();
        await sendMessage(chatId, `✅ کانال تنظیم شد: ${config.vipChannelId} (ربات باید ادمین کانال باشد).`);
        return;
      }

      // Admin waiting state
      if (config.waitingFor && config.waitingFor[userId] && msg.text) {
        const w = config.waitingFor[userId];
        const val = msg.text.trim();
        switch (w.type) {
          case 'WELCOME': config.welcomeMessage = val; break;
          case 'AGREEMENT': config.agreementText = val; break;
          case 'VIP': 
            if (val.includes('t.me/+')) { config.manualVipLinks.current = val; }
            else if (val.startsWith('@') || /^\-?\d+$/.test(val)) { config.vipChannelId = val; }
            else { config.manualVipLinks.current = val; }
            break;
          case 'ADDADMIN': 
            let newId = val;
            if (val.startsWith('@')) {
              const g = await tg('getChat', { chat_id: val });
              if (g && g.ok && g.result?.id) newId = String(g.result.id);
              else { await sendMessage(chatId, '❌ نتوانستم یوزرنیم را پیدا کنم. لطفاً شناسه عددی ارسال کن.'); delete config.waitingFor[userId]; saveConfig(); return; }
            }
            if (!config.admins.map(x => String(x)).includes(String(newId))) config.admins.push(String(newId));
            break;
          case 'REMOVEADMIN':
            let removeId = val.startsWith('@') ? val : val;
            if (val.startsWith('@')) {
              const g = await tg('getChat', { chat_id: val });
              if (g && g.ok && g.result?.id) removeId = String(g.result.id);
              else { await sendMessage(chatId, '❌ نتوانستم یوزرنیم را پیدا کنم. لطفاً شناسه عددی ارسال کن.'); delete config.waitingFor[userId]; saveConfig(); return; }
            }
            config.admins = config.admins.filter(a => String(a) !== String(removeId));
            break;
          default: break;
        }
        delete config.waitingFor[userId];
        saveConfig();
        await sendMessage(chatId, '✅ انجام شد.');
        return;
      }

      // /start
      if (msg.text && msg.text.trim() === '/start') {
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, `برای اشتراک شماره تماس، دکمه زیر را بزنید:`, contactKeyboard());
        return;
      }

      // Contact (phone)
      if (msg.contact) {
        const c = msg.contact;
        if (c.user_id && String(c.user_id) !== userId) { await sendMessage(chatId, 'لطفاً شمارهٔ خودتان را ارسال کنید.'); return; }
        users[userId].phone = c.phone_number || '';
        saveUsers();
        await sendMessage(chatId, config.agreementText, {
          reply_markup: JSON.stringify({ inline_keyboard: [[{ text: config.agreementButton, callback_data: 'AGREE' }]] })
        });
        return;
      }

      // Admin commands
      if (msg.text) {
        const text = msg.text.trim();
        if (text.startsWith('/setchannel')) {
          if (!isAdmin(userId)) { await sendMessage(chatId, '⛔ شما ادمین نیستید.'); return; }
          const parts = text.split(' ').filter(Boolean);
          if (parts.length >= 2) {
            const val = parts[1].trim();
            if (val.includes('t.me/+')) { config.manualVipLinks.current = val; saveConfig(); await sendMessage(chatId, `✅ لینک خصوصی ثبت شد.`); return; }
            else if (val.startsWith('@') || /^\-?\d+$/.test(val)) { config.vipChannelId = val; saveConfig(); await sendMessage(chatId, `✅ vipChannelId تنظیم شد: ${val}`); return; }
            else { config.manualVipLinks.current = val; saveConfig(); await sendMessage(chatId, `✅ لینک دستی ثبت شد.`); return; }
          } else { await sendMessage(chatId, 'برای تنظیم کانال: پیام کانال را فوروارد کن یا /setchannel <@username یا id یا لینک t.me/+...> را ارسال کن.'); return; }
        }

        if (text.toLowerCase() === '/admin') {
          if (!isAdmin(userId)) { await sendMessage(chatId, '⛔ شما ادمین نیستید.'); return; }
          await sendMessage(chatId, 'پنل
