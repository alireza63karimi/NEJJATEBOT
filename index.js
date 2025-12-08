// index.js
// NEJJATEBOT - Final Render-ready (2025)
// Node >=18 required (global fetch available)

const express = require('express');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');
const TOKEN_PATH = '/etc/secrets/bot_token.txt'; // Render Secret File path

// -------------------- Load Bot Token --------------------
let BOT_TOKEN = process.env.BOT_TOKEN || null;
try {
  if (!BOT_TOKEN && fs.existsSync(TOKEN_PATH)) {
    BOT_TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
} catch (e) {
  console.error('Failed to read token file:', e?.message);
}
if (!BOT_TOKEN) {
  console.error('❌ Bot token not found. Put token in Secret File /etc/secrets/bot_token.txt or set BOT_TOKEN env.');
  process.exit(1);
}
const TELEGRAM_API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

// -------------------- Safe JSON helpers --------------------
function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const txt = fs.readFileSync(file, 'utf8');
    return txt ? JSON.parse(txt) : fallback;
  } catch (e) {
    console.error('loadJson error', file, e?.message);
    try { fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); } catch (_) {}
    return fallback;
  }
}
function saveJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('saveJson error', file, e?.message);
  }
}

// -------------------- Config / Users --------------------
const DEFAULT_CONFIG = {
  welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
  agreementButton: "تایید میکنم ✅",
  // manual fallback link (t.me/...); editable by admins
  vipChannelLink: "",
  // vipChannelId: either @username or numeric id (used for createChatInviteLink)
  vipChannelId: null,
  // "auto" uses createChatInviteLink (requires bot admin in channel), "manual" sends vipChannelLink/manualVipLinks.current
  vipSendMode: "auto",
  // initial admins (strings)
  admins: ["6043389836", "188225902"],
  waitingFor: {}, // per-admin waiting state
  manualVipLinks: { current: null }
};

let config = loadJson(CONFIG_FILE, DEFAULT_CONFIG);
let users = loadJson(USERS_FILE, {});

// helper saves
function saveConfig() { saveJson(CONFIG_FILE, config); }
function saveUsers() { saveJson(USERS_FILE, users); }

// admin check
function isAdmin(uid) {
  if (!uid) return false;
  return Array.isArray(config.admins) && config.admins.map(String).includes(String(uid));
}

// chunk text for long lists
function chunkText(text, n = 4000) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

// -------------------- Telegram API helpers --------------------
async function tg(method, body) {
  try {
    const res = await fetch(TELEGRAM_API(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return await res.json();
  } catch (e) {
    console.error('tg fetch failed', method, e?.message);
    return null;
  }
}
async function sendMessage(chat_id, text, extra = {}) {
  try {
    return await tg('sendMessage', Object.assign({ chat_id, text: String(text), parse_mode: 'HTML' }, extra));
  } catch (e) {
    console.error('sendMessage error', e?.message);
  }
}
async function answerCallback(cb_id, text = '') {
  if (!cb_id) return;
  try { await tg('answerCallbackQuery', { callback_query_id: cb_id, text }); } catch (e) { /* ignore */ }
}

// -------------------- Keyboards --------------------
function contactKeyboard() {
  // label must match requirement: "اشتراک شماره تماس"
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
        [{ text: '🔁 لینک اتومات (یکبارمصرف)', callback_data: 'VIP_MODE_AUTO' }, { text: '✋ لینک دستی', callback_data: 'VIP_MODE_MANUAL' }]
      ]
    })
  };
}

// -------------------- Invite queue (fast & memory-light) --------------------
const inviteQueue = [];
const inviteCache = new Map(); // per-user short cache
let activeWorkers = 0;
const MAX_WORKERS = 4; // tuned for limited memory (Render free)

async function resolveChannelToId(identifier) {
  if (!identifier) return null;
  if (typeof identifier === 'number') return identifier;
  if (typeof identifier === 'string' && /^\-?\d+$/.test(identifier)) return Number(identifier);
  if (typeof identifier === 'string' && identifier.startsWith('@')) {
    const info = await tg('getChat', { chat_id: identifier });
    if (info && info.ok && info.result && info.result.id) return info.result.id;
    return null;
  }
  return null;
}

async function createChatInvite(channelIdentifier) {
  if (!channelIdentifier) return { ok: false, error: 'no_channel' };
  // check private t.me/+ cannot be used by createChatInviteLink; admin should set id or @username
  if (typeof channelIdentifier === 'string' && channelIdentifier.includes('t.me/+')) {
    return { ok: false, error: 'private_link_no_id' };
  }
  const chat_id = await resolveChannelToId(channelIdentifier);
  if (!chat_id) return { ok: false, error: 'invalid_channel' };
  const expire_date = Math.floor(Date.now() / 1000) + 86400; // 24h
  const res = await tg('createChatInviteLink', { chat_id, member_limit: 1, expire_date, creates_join_request: false });
  if (res && res.ok && res.result && res.result.invite_link) return { ok: true, link: res.result.invite_link, expiresAt: expire_date * 1000 };
  return { ok: false, error: res?.description || 'create_failed' };
}

async function createInviteForUser(userId) {
  // cache 30 seconds
  const cached = inviteCache.get(userId);
  if (cached && Date.now() < cached.cacheExpiresAt) return { ok: true, link: cached.link, expiresAt: cached.expiresAt };

  // call createChatInviteLink
  const res = await createChatInvite(config.vipChannelId);
  if (res.ok) {
    inviteCache.set(userId, { link: res.link, expiresAt: res.expiresAt, cacheExpiresAt: Date.now() + 30 * 1000 });
  }
  return res;
}

async function processQueueTask(task) {
  const { userId, chatId, callbackId, retries = 0 } = task;
  try {
    const res = await createInviteForUser(userId);
    if (res.ok) {
      await sendMessage(chatId, `🔗 لینک VIP شما (یکبار مصرف — معتبر تا 24 ساعت):\n${res.link}`);
      users[userId] = users[userId] || { id: userId, first_name: '', last_name: '', username: '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
      users[userId].vipSent = true; saveUsers();
      if (callbackId) await answerCallback(callbackId);
    } else {
      // special fallback for private link case
      if (res.error === 'private_link_no_id') {
        const fallback = config.manualVipLinks?.current || config.vipChannelLink || 'تنظیم نشده';
        await sendMessage(chatId, `⚠️ کانال برای ساخت لینک اتومات، شناسه صحیح ندارد. لینک دستی:\n${fallback}`);
        if (callbackId) await answerCallback(callbackId);
        if (!users[userId]?.vipSent) { users[userId] = users[userId] || {}; users[userId].vipSent = true; saveUsers(); }
      } else {
        // retry a couple times then fallback
        if (retries < 2) inviteQueue.push({ userId, chatId, callbackId, retries: retries + 1 });
        else {
          const fallback = config.manualVipLinks?.current || config.vipChannelLink || 'تنظیم نشده';
          await sendMessage(chatId, `❌ خطا در ساخت لینک یکبارمصرف (${res.error}).\nلینک جایگزین:\n${fallback}`);
          if (callbackId) await answerCallback(callbackId);
          if (!users[userId]?.vipSent) { users[userId] = users[userId] || {}; users[userId].vipSent = true; saveUsers(); }
        }
      }
    }
  } catch (e) {
    console.error('processQueueTask error', e?.message);
    if (task.retries < 2) inviteQueue.push({ userId, chatId, callbackId, retries: (task.retries || 0) + 1 });
    else {
      const fallback = config.manualVipLinks?.current || config.vipChannelLink || 'تنظیم نشده';
      await sendMessage(chatId, `❌ خطای داخلی. لینک جایگزین:\n${fallback}`);
      if (!users[userId]?.vipSent) { users[userId] = users[userId] || {}; users[userId].vipSent = true; saveUsers(); }
      if (callbackId) await answerCallback(callbackId);
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
    // don't await - fire-and-forget concurrent workers
    processQueueTask(task);
  }
}

// -------------------- sendVip logic --------------------
async function sendVipLinkToUser(userId, chatId, callbackId = null) {
  users[userId] = users[userId] || { id: userId, first_name: '', last_name: '', username: '', phone: '', vipSent: false, joinDate: new Date().toISOString() };

  // Non-admins: only once
  if (users[userId].vipSent && !isAdmin(userId)) {
    if (callbackId) await answerCallback(callbackId, '⚠️ شما قبلاً لینک را دریافت کرده‌اید.');
    return { ok: false, reason: 'already_sent' };
  }

  // Manual mode: send fixed link
  if (config.vipSendMode === 'manual') {
    const link = config.manualVipLinks?.current || config.vipChannelLink || 'تنظیم نشده';
    await sendMessage(chatId, `🔗 لینک VIP شما:\n${link}`);
    if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
    if (callbackId) await answerCallback(callbackId);
    return { ok: true };
  }

  // Auto mode: queue to create one-time invite links
  if (!config.vipChannelId) {
    const fallback = config.manualVipLinks?.current || config.vipChannelLink || 'تنظیم نشده';
    if (callbackId) await answerCallback(callbackId, '❌ کانال برای حالت اتومات تنظیم نشده؛ لینک دستی ارسال می‌شود.');
    await sendMessage(chatId, `🔗 لینک VIP شما:\n${fallback}`);
    if (!users[userId].vipSent) { users[userId].vipSent = true; saveUsers(); }
    return { ok: false, reason: 'no_channel_id' };
  }

  inviteQueue.push({ userId, chatId, callbackId });
  scheduleQueue();
  return { ok: true, queued: true };
}

// -------------------- Express webhook --------------------
const app = express();
app.use(express.json({ limit: '200kb' }));

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (!update) return res.status(200).send({ ok: false, message: 'no update' });

    // Validate secret header if configured
    if (WEBHOOK_SECRET) {
      const header = req.get('x-telegram-bot-api-secret-token');
      if (!header || header !== WEBHOOK_SECRET) return res.status(403).send({ ok: false, message: 'unauthorized' });
    }

    // acknowledge immediately to avoid webhook timeouts
    res.sendStatus(200);

    // ---------- message handling ----------
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat?.id;
      const from = msg.from || {};
      if (!chatId || !from.id) return;

      const userId = String(from.id);

      // ensure user exists
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
      }

      // If admin forwards channel post -> set vipChannelId
      if (msg.forward_from_chat && isAdmin(userId)) {
        const ch = msg.forward_from_chat;
        config.vipChannelId = ch.username ? `@${ch.username}` : String(ch.id);
        saveConfig();
        await sendMessage(chatId, `✅ کانال تنظیم شد: ${config.vipChannelId} (ربات باید ادمین کانال باشد).`);
        return;
      }

      // handle per-admin waiting state (text responses)
      if (config.waitingFor && config.waitingFor[userId] && msg.text) {
        const w = config.waitingFor[userId];
        const val = msg.text.trim();

        if (w.type === 'WELCOME') { config.welcomeMessage = val; }
        else if (w.type === 'AGREEMENT') { config.agreementText = val; }
        else if (w.type === 'VIP') {
          if (val.includes('t.me/+')) { config.manualVipLinks = config.manualVipLinks || {}; config.manualVipLinks.current = val; }
          else if (val.startsWith('@') || /^\-?\d+$/.test(val)) { config.vipChannelId = val; }
          else { config.manualVipLinks = config.manualVipLinks || {}; config.manualVipLinks.current = val; }
        }
        else if (w.type === 'ADDADMIN') {
          let newId = val;
          if (val.startsWith('@')) {
            const g = await tg('getChat', { chat_id: val });
            if (g && g.ok && g.result && g.result.id) newId = String(g.result.id);
            else { await sendMessage(chatId, '❌ نتوانستم یوزرنیم را پیدا کنم. لطفاً شناسه عددی ارسال کن.'); delete config.waitingFor[userId]; saveConfig(); return; }
          }
          if (!config.admins.map(String).includes(String(newId))) config.admins.push(String(newId));
        }
        else if (w.type === 'REMOVEADMIN') {
          let removeId = val;
          if (val.startsWith('@')) {
            const g = await tg('getChat', { chat_id: val });
            if (g && g.ok && g.result && g.result.id) removeId = String(g.result.id);
            else { await sendMessage(chatId, '❌ نتوانستم یوزرنیم را پیدا کنم. لطفاً شناسه عددی ارسال کن.'); delete config.waitingFor[userId]; saveConfig(); return; }
          }
          config.admins = config.admins.filter(a => String(a) !== String(removeId));
        }

        delete config.waitingFor[userId];
        saveConfig();
        await sendMessage(chatId, '✅ انجام شد.');
        return;
      }

      // /start command
      if (msg.text && msg.text.trim().toLowerCase() === '/start') {
        await sendMessage(chatId, config.welcomeMessage || DEFAULT_CONFIG.welcomeMessage);
        await sendMessage(chatId, 'برای اشتراک شماره تماس، دکمه زیر را بزنید:', contactKeyboard());
        return;
      }

      // contact (phone) handling
      if (msg.contact) {
        const c = msg.contact;
        if (c.user_id && String(c.user_id) !== userId) { await sendMessage(chatId, 'لطفاً شمارهٔ خودتان را ارسال کنید.'); return; }
        users[userId].phone = c.phone_number || '';
        saveUsers();
        // send agreement with inline button (label from config)
        await sendMessage(chatId, config.agreementText || DEFAULT_CONFIG.agreementText, {
          reply_markup: JSON.stringify({ inline_keyboard: [[{ text: config.agreementButton || DEFAULT_CONFIG.agreementButton, callback_data: 'AGREE' }]] })
        });
        return;
      }

      // admin-only commands: /setchannel and /admin
      if (msg.text) {
        const txt = msg.text.trim();
        if (txt.startsWith('/setchannel')) {
          if (!isAdmin(userId)) { await sendMessage(chatId, '⛔ شما ادمین نیستید.'); return; }
          const parts = txt.split(' ').filter(Boolean);
          if (parts.length >= 2) {
            const val = parts[1].trim();
            if (val.includes('t.me/+')) {
              config.manualVipLinks = config.manualVipLinks || {};
              config.manualVipLinks.current = val;
              saveConfig();
              await sendMessage(chatId, `✅ لینک خصوصی (دستی) ثبت شد. برای لینک اتومات نیاز به @username یا id کانال است.`);
              return;
            } else if (val.startsWith('@') || /^\-?\d+$/.test(val)) {
              config.vipChannelId = val;
              saveConfig();
              await sendMessage(chatId, `✅ vipChannelId تنظیم شد: ${val}`);
              return;
            } else {
              config.manualVipLinks = config.manualVipLinks || {};
              config.manualVipLinks.current = val;
              saveConfig();
              await sendMessage(chatId, `✅ لینک دستی ثبت شد.`);
              return;
            }
          } else {
            await sendMessage(chatId, 'برای تنظیم کانال: پیام کانال را فوروارد کن یا /setchannel <@username یا id یا لینک t.me/+...> را ارسال کن.');
            return;
          }
        }

        if (txt.toLowerCase() === '/admin') {
          if (!isAdmin(userId)) { await sendMessage(chatId, '⛔ شما ادمین نیستید.'); return; }
          await sendMessage(chatId, 'پنل مدیریت:', adminInlineKeyboard());
          return;
        }
      }
    } // end update.message

    // ---------- callback_query handling ----------
    if (update.callback_query) {
      const cb = update.callback_query;
      const from = cb.from || {};
      const userId = String(from.id);
      const data = cb.data;
      const chatId = cb.message?.chat?.id || userId;

      // agreement confirmation
      if (data === 'AGREE') {
        await sendVipLinkToUser(userId, chatId, cb.id);
        return;
      }

      // admin callbacks
      if (data && data.startsWith('ADMIN_')) {
        if (!isAdmin(userId)) { await answerCallback(cb.id, '⛔ شما ادمین نیستید.'); return; }
        switch (data) {
          case 'ADMIN_VIEW_WELCOME':
            await answerCallback(cb.id); await sendMessage(chatId, `پیام خوش‌آمد فعلی:\n\n${config.welcomeMessage}`); break;
          case 'ADMIN_EDIT_WELCOME':
            config.waitingFor = config.waitingFor || {}; config.waitingFor[userId] = { type: 'WELCOME' }; saveConfig();
            await answerCallback(cb.id); await sendMessage(chatId, 'لطفاً متن جدید خوش‌آمد را ارسال کنید.'); break;
          case 'ADMIN_VIEW_AGREEMENT':
            await answerCallback(cb.id); await sendMessage(chatId, `متن توافقنامه فعلی:\n\n${config.agreementText}`); break;
          case 'ADMIN_EDIT_AGREEMENT':
            config.waitingFor = config.waitingFor || {}; config.waitingFor[userId] = { type: 'AGREEMENT' }; saveConfig();
            await answerCallback(cb.id); await sendMessage(chatId, 'لطفاً متن جدید توافقنامه را ارسال کنید.'); break;
          case 'ADMIN_VIEW_VIP':
            await answerCallback(cb.id);
            await sendMessage(chatId, `لینک دستی VIP:\n${config.manualVipLinks?.current || config.vipChannelLink || 'تنظیم نشده'}\n\nvipChannelId (برای اتومات): ${config.vipChannelId || 'تنظیم نشده'}`);
            break;
          case 'ADMIN_EDIT_VIP':
            config.waitingFor = config.waitingFor || {}; config.waitingFor[userId] = { type: 'VIP' }; saveConfig();
            await answerCallback(cb.id); await sendMessage(chatId, 'لطفاً لینک جدید VIP یا شناسه کانال را ارسال کنید.'); break;
          case 'ADMIN_VIEW_ADMINS':
            await answerCallback(cb.id); await sendMessage(chatId, `ادمین‌ها:\n${config.admins.join('\n')}`); break;
          case 'ADMIN_LIST_USERS': {
            await answerCallback(cb.id);
            const lines = Object.values(users).map(u => `${u.id}|${u.first_name||''} ${u.last_name||''}|${u.username?('@'+u.username):'-'}|${u.phone||'-'}|vip:${u.vipSent?'✅':'❌'}`).join('\n');
            for (const p of chunkText(lines)) { await sendMessage(chatId, p); }
            break;
          }
          case 'ADMIN_ADD_ADMIN':
            config.waitingFor = config.waitingFor || {}; config.waitingFor[userId] = { type: 'ADDADMIN' }; saveConfig();
            await answerCallback(cb.id); await sendMessage(chatId, 'شناسه عددی یا @username برای اضافه شدن به ادمین‌ها ارسال کن.'); break;
          case 'ADMIN_REMOVE_ADMIN':
            config.waitingFor = config.waitingFor || {}; config.waitingFor[userId] = { type: 'REMOVEADMIN' }; saveConfig();
            await answerCallback(cb.id); await sendMessage(chatId, 'شناسه ادمینی که می‌خواهی حذف شود را ارسال کن.'); break;
          case 'VIP_MODE_AUTO':
            config.vipSendMode = 'auto'; saveConfig(); await answerCallback(cb.id, '✅ حالت VIP روی اتوماتیک تنظیم شد.'); break;
          case 'VIP_MODE_MANUAL':
            config.vipSendMode = 'manual'; saveConfig(); await answerCallback(cb.id, '✅ حالت VIP روی دستی تنظیم شد.'); break;
          default:
            await answerCallback(cb.id);
        }
        return;
      }
    }

  } catch (e) {
    console.error('Webhook handler error', e?.stack || e?.message || e);
  }
});

// -------------------- Start Server & Set Webhook --------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const WEBHOOK_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || null);
  if (!WEBHOOK_URL) {
    console.warn('WEBHOOK_URL not set. Set WEBHOOK_URL environment variable in Render (Environment).');
    return;
  }
  const payload = { url: `${WEBHOOK_URL.replace(/\/$/, '')}/webhook` };
  if (process.env.WEBHOOK_SECRET) payload.secret_token = process.env.WEBHOOK_SECRET;
  try {
    const res = await tg('setWebhook', payload);
    console.log('setWebhook result:', res?.ok ? 'ok' : res);
  } catch (e) {
    console.error('setWebhook failed', e?.message);
  }
});
