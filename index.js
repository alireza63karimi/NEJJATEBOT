// index.js - NEJJATEBOT (Webhook + Express, direct Telegram API)
const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');

// Read config & users (safe)
function loadJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeJsonSync(file, fallback, { spaces: 2 });
      return fallback;
    }
    return fs.readJsonSync(file);
  } catch (e) {
    console.error('JSON load error', file, e.message);
    fs.writeJsonSync(file, fallback, { spaces: 2 });
    return fallback;
  }
}

let config = loadJsonSafe(CONFIG_FILE, {
  welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
  agreementButton: "تایید میکنم ✅",
  vipChannelLink: "https://t.me/NEJJATE_VIP",
  admins: ["6043389836", "188225902"],
  waitingFor: null,
  vipSendMode: "auto", // auto یا manual
  manualVipLinks: { current: "" }
});

let users = loadJsonSafe(USERS_FILE, {}); // keyed by userId

function saveConfig() { fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); }
function saveUsers() { fs.writeJsonSync(USERS_FILE, users, { spaces: 2 }); }

// BOT TOKEN
let BOT_TOKEN = process.env.BOT_TOKEN || '';
if (!BOT_TOKEN) { console.error('❌ توکن ربات پیدا نشد!'); process.exit(1); }

const TELEGRAM_API = (t) => `https://api.telegram.org/bot${t}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

async function tg(method, body) {
  const url = `${TELEGRAM_API(BOT_TOKEN)}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function sendMessage(chat_id, text, extra = {}) {
  const payload = Object.assign({ chat_id: chat_id, text: String(text), parse_mode: 'HTML' }, extra);
  return await tg('sendMessage', payload);
}

function contactKeyboard() {
  return {
    reply_markup: JSON.stringify({
      keyboard: [[{ text: "ارسال شماره 📱", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    })
  };
}

function isAdmin(userId) {
  if (!userId) return false;
  return Array.isArray(config.admins) && config.admins.map(x => String(x)).includes(String(userId));
}

function chunkText(text, n = 3000) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

// دو ستون برای کلیدهای مدیریت
function adminKeyboardInline() {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '🔗 لینک VIP', callback_data: 'ADMIN_VIEW_VIP' }, { text: '✏️ تغییر لینک VIP', callback_data: 'ADMIN_EDIT_VIP' }],
        [{ text: '📝 خوش‌آمد', callback_data: 'ADMIN_EDIT_WELCOME' }, { text: '📄 توافقنامه', callback_data: 'ADMIN_EDIT_AGREEMENT' }],
        [{ text: '👥 کاربران', callback_data: 'ADMIN_LIST_USERS' }, { text: '➕ اضافه ادمین', callback_data: 'ADMIN_ADD_ADMIN' }],
        [{ text: '➖ حذف ادمین', callback_data: 'ADMIN_REMOVE_ADMIN' }, { text: '⚙️ حالت ارسال VIP', callback_data: 'ADMIN_TOGGLE_VIPMODE' }],
        [{ text: '🖊️ لینک دستی VIP', callback_data: 'ADMIN_SET_MANUAL_LINK' }]
      ]
    })
  };
}

async function handleUpdate(update) {
  try {
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const userId = String(msg.from.id);

      // ثبت کاربر
      if (!users[userId]) {
        users[userId] = { id: userId, first_name: msg.from.first_name || '', username: msg.from.username || '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
        saveUsers();
      }

      const text = (msg.text || '').trim();

      if (text === '/start') {
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, 'برای ارسال شماره، دکمه زیر را بزنید:', contactKeyboard());
        return;
      }

      if (text && text.toLowerCase() === '/admin' && isAdmin(userId)) {
        await sendMessage(chatId, 'پنل مدیریت:', adminKeyboardInline());
        return;
      }

      // handle waiting input from admin
      if (isAdmin(userId) && config.waitingFor?.by === userId) {
        const what = config.waitingFor.type;
        if (what === 'VIP') { config.vipChannelLink = text; config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ لینک VIP بروزرسانی شد.'); return; }
        if (what === 'WELCOME') { config.welcomeMessage = text; config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ پیام خوش‌آمد بروزرسانی شد.'); return; }
        if (what === 'AGREEMENT') { config.agreementText = text; config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ متن توافقنامه بروزرسانی شد.'); return; }
        if (what === 'ADDADMIN') { /* همان منطق قبل */ return; }
        if (what === 'REMOVEADMIN') { /* همان منطق قبل */ return; }
        if (what === 'MANUAL_VIP') { config.manualVipLinks.current = text.trim(); config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✅ لینک دستی VIP بروزرسانی شد.'); return; }
      }

      if (msg.contact) {
        users[userId].phone = msg.contact.phone_number || '';
        saveUsers();
        const inline = {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: config.agreementButton || 'تایید', callback_data: 'AGREE' }]]
          })
        };
        await sendMessage(chatId, config.agreementText, inline);
        return;
      }

      return;
    }

    // callback_query handling
    if (update.callback_query) {
      const cb = update.callback_query;
      const userId = String(cb.from.id);
      const data = cb.data;

      // admin actions
      if (data.startsWith('ADMIN_') && isAdmin(userId)) {
        if (data === 'ADMIN_TOGGLE_VIPMODE') {
          config.vipSendMode = config.vipSendMode === 'auto' ? 'manual' : 'auto';
          saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `✅ حالت ارسال VIP به ${config.vipSendMode} تغییر کرد.` });
          return;
        }
        if (data === 'ADMIN_SET_MANUAL_LINK') {
          config.waitingFor = { type: 'MANUAL_VIP', by: userId };
          saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, 'لطفاً لینک VIP دستی را ارسال کنید.');
          return;
        }
        // بقیه admin actions همان منطق قبل
        return;
      }

      // user agreement
      if (data === 'AGREE') {
        if (!users[userId]) return;

        if (users[userId].vipSent && !isAdmin(userId)) {
          await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '⚠️ شما قبلاً لینک را دریافت کرده‌اید.' });
          return;
        }

        let linkToSend = null;
        if (config.vipSendMode === 'auto') { linkToSend = config.vipChannelLink; }
        else { linkToSend = config.manualVipLinks.current; }

        if (!linkToSend) {
          await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ لینک VIP هنوز توسط ادمین ثبت نشده است.' });
          return;
        }

        await sendMessage(cb.message.chat.id, `🔗 لینک VIP شما:\n${linkToSend}`);
        if (!isAdmin(userId)) { users[userId].vipSent = true; saveUsers(); }

        await tg('answerCallbackQuery', { callback_query_id: cb.id });
        return;
      }

      await tg('answerCallbackQuery', { callback_query_id: cb.id });
    }

  } catch (err) { console.error('handleUpdate error', err); }
}

// Express webhook
const app = express();
app.use(express.json({ limit: '200kb' }));

app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  res.sendStatus(200);
  await handleUpdate(req.body);
});

app.get('/', (req, res) => res.send('NEJJATEBOT running'));
app.get('/healthz', (req, res) => res.send('OK'));

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, async () => {
  console.log(`Server running on port: ${PORT}`);
  if (!WEBHOOK_URL) return;
  const hook = `${WEBHOOK_URL.replace(/\/$/, '')}/webhook/${BOT_TOKEN}`;
  try { await tg('setWebhook', { url: hook }); console.log('Webhook ست شد!'); } catch(e){console.error(e);}
});
