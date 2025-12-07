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
  waitingFor: null
});

let users = loadJsonSafe(USERS_FILE, {}); // keyed by userId (string)

function saveConfig() { fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); }
function saveUsers() { fs.writeJsonSync(USERS_FILE, users, { spaces: 2 }); }

// BOT TOKEN: try Render Secret File path, then local file, then env
let BOT_TOKEN = null;
const SECRET_PATH_RENDER = '/etc/secrets/bot_token.txt';
if (fs.existsSync(SECRET_PATH_RENDER)) {
  try { BOT_TOKEN = fs.readFileSync(SECRET_PATH_RENDER, 'utf8').trim(); } catch(e) {}
}
if (!BOT_TOKEN && fs.existsSync(path.join(ROOT, 'bot_token.txt'))) {
  try { BOT_TOKEN = fs.readFileSync(path.join(ROOT, 'bot_token.txt'), 'utf8').trim(); } catch(e) {}
}
if (!BOT_TOKEN && process.env.BOT_TOKEN) BOT_TOKEN = process.env.BOT_TOKEN.trim();

if (!BOT_TOKEN) {
  console.error('❌ توکن ربات پیدا نشد! لطفاً فایل secret با نام bot_token.txt در Render اضافه کن یا متغیر محیطی BOT_TOKEN را ست کن.');
  process.exit(1);
}

const TELEGRAM_API = (t) => `https://api.telegram.org/bot${t}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';

if (!WEBHOOK_URL) {
  console.error('❌ متغیر محیطی WEBHOOK_URL تنظیم نشده. لطفاً آدرس عمومی سرویس Render خود را در WEBHOOK_URL قرار بده.');
  // don't exit; we can continue to run but webhook won't be set
}

// helper to call Telegram
async function tg(method, body) {
  const url = `${TELEGRAM_API(BOT_TOKEN)}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

// sendMessage wrapper
async function sendMessage(chat_id, text, extra = {}) {
  const payload = Object.assign({ chat_id: chat_id, text: String(text), parse_mode: 'HTML' }, extra);
  return await tg('sendMessage', payload);
}

// sendReplyKeyboardContact
function contactKeyboard() {
  return {
    reply_markup: JSON.stringify({
      keyboard: [[{ text: "ارسال شماره 📱", request_contact: true }]],
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

// handle update (message or callback_query)
async function handleUpdate(update) {
  try {
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const from = msg.from || {};
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
      } else {
        // refresh profile fields
        users[userId].first_name = from.first_name || users[userId].first_name;
        users[userId].last_name = from.last_name || users[userId].last_name;
        users[userId].username = from.username || users[userId].username;
      }

      // commands
      const text = (msg.text || '').trim();

      // /start
      if (text === '/start') {
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, 'برای ارسال شماره، دکمه زیر را بزنید:', contactKeyboard());
        return;
      }

      // admin command /admin (case-insensitive)
      if (text && text.toLowerCase() === '/admin') {
        if (!isAdmin(userId)) {
          await sendMessage(chatId, '⛔ شما ادمین نیستید.');
          return;
        }
        // send admin menu (inline keyboard)
        const keyboard = {
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: '🔗 نمایش لینک VIP فعلی', callback_data: 'ADMIN_VIEW_VIP' }],
              [{ text: '✏️ تغییر لینک VIP', callback_data: 'ADMIN_EDIT_VIP' }],
              [{ text: '📝 تغییر پیام خوش‌آمد', callback_data: 'ADMIN_EDIT_WELCOME' }],
              [{ text: '📄 تغییر متن توافقنامه', callback_data: 'ADMIN_EDIT_AGREEMENT' }],
              [{ text: '👥 مشاهده کاربران', callback_data: 'ADMIN_LIST_USERS' }],
              [{ text: '➕ اضافه کردن ادمین', callback_data: 'ADMIN_ADD_ADMIN' }],
              [{ text: '➖ حذف ادمین', callback_data: 'ADMIN_REMOVE_ADMIN' }]
            ]
          })
        };
        await sendMessage(chatId, 'پنل مدیریت:', keyboard);
        return;
      }

      // handle text while waiting for admin input
      if (isAdmin(userId) && config.waitingFor && config.waitingFor.by === userId) {
        const what = config.waitingFor.type;
        if (what === 'VIP') {
          config.vipChannelLink = text;
          config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ لینک VIP بروزرسانی شد.');
          return;
        }
        if (what === 'WELCOME') {
          config.welcomeMessage = text;
          config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ پیام خوش‌آمد بروزرسانی شد.');
          return;
        }
        if (what === 'AGREEMENT') {
          config.agreementText = text;
          config.waitingFor = null; saveConfig(); await sendMessage(chatId, '✔ متن توافقنامه بروزرسانی شد.');
          return;
        }
        if (what === 'ADDADMIN') {
          // accept numeric id or @username (if @username, try getChat)
          const candidate = text.trim();
          let newId = null;
          if (/^\d+$/.test(candidate)) { newId = String(candidate); }
          else if (candidate.startsWith('@')) {
            // try getChat
            try {
              const res = await tg('getChat', { chat_id: candidate });
              if (res && res.ok && res.result && res.result.id) newId = String(res.result.id);
            } catch (e) {
              newId = null;
            }
          }
          if (!newId) {
            config.waitingFor = null; saveConfig();
            await sendMessage(chatId, '❌ شناسهٔ معتبر نبود. لطفاً یک عدد (user id) معتبر ارسال کن.');
            return;
          }
          if (!config.admins.map(x => String(x)).includes(newId)) {
            config.admins.push(String(newId)); saveConfig();
            config.waitingFor = null;
            await sendMessage(chatId, `✅ ادمین با id ${newId} اضافه شد.`);
            return;
          } else {
            config.waitingFor = null; saveConfig();
            await sendMessage(chatId, 'این شناسه قبلاً ادمین است.');
            return;
          }
        }
        if (what === 'REMOVEADMIN') {
          const candidate = text.trim();
          if (!/^\d+$/.test(candidate)) {
            config.waitingFor = null; saveConfig();
            await sendMessage(chatId, 'فرمت اشتباه است. لطفاً فقط user id را ارسال کن.');
            return;
          }
          const idStr = String(candidate);
          if (!config.admins.map(x => String(x)).includes(idStr)) {
            config.waitingFor = null; saveConfig();
            await sendMessage(chatId, 'این شناسه ادمین نیست.');
            return;
          }
          config.admins = config.admins.filter(a => String(a) !== idStr); saveConfig();
          config.waitingFor = null;
          await sendMessage(chatId, `✅ ادمین با id ${idStr} حذف شد.`);
          return;
        }
      }

      // contact message handling
      if (msg.contact) {
        // validate contact belongs to sender (telegram sets contact.user_id in many clients)
        const contact = msg.contact;
        if (contact.user_id && String(contact.user_id) !== userId) {
          await sendMessage(chatId, 'لطفاً شمارهٔ خودتان را ارسال کنید (دکمه ارسال شماره را بزنید).');
          return;
        }
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

      // if user typed other text (non-command) do nothing
      return;
    }

    // callback_query handling
    if (update.callback_query) {
      const cb = update.callback_query;
      const from = cb.from || {};
      const userId = String(from.id);
      const data = cb.data;

      // admin callback actions
      if (data && data.startsWith('ADMIN_')) {
        if (!isAdmin(userId)) {
          // answer callback
          await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '⛔ شما ادمین نیستید.' });
          return;
        }

        if (data === 'ADMIN_VIEW_VIP') {
          const vip = config.vipChannelLink || 'هنوز لینک ثبت نشده';
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, `🔗 لینک VIP فعلی:\n${vip}`);
          return;
        }

        if (data === 'ADMIN_EDIT_VIP') {
          config.waitingFor = { type: 'VIP', by: userId }; saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, 'لطفاً لینک جدید VIP را ارسال کنید (پیام حاوی لینک).');
          return;
        }

        if (data === 'ADMIN_EDIT_WELCOME') {
          config.waitingFor = { type: 'WELCOME', by: userId }; saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, 'لطفاً متن جدید خوش‌آمد را ارسال کنید.');
          return;
        }

        if (data === 'ADMIN_EDIT_AGREEMENT') {
          config.waitingFor = { type: 'AGREEMENT', by: userId }; saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, 'لطفاً متن جدید توافقنامه را ارسال کنید.');
          return;
        }

        if (data === 'ADMIN_LIST_USERS') {
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          const lines = Object.values(users).map(u => {
            return `${u.id} | ${u.first_name || ''} ${u.last_name || ''} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | ${u.joinDate || '-'} | vip:${u.vipSent ? '✅':'❌'}`;
          }).join('\n');
          if (!lines) {
            await sendMessage(cb.message.chat.id, 'هیچ کاربری ثبت نشده.');
            return;
          }
          const parts = chunkText(lines, 3000);
          for (const p of parts) await sendMessage(cb.message.chat.id, p);
          return;
        }

        if (data === 'ADMIN_ADD_ADMIN') {
          config.waitingFor = { type: 'ADDADMIN', by: userId }; saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, 'شناسهٔ عددی کاربر (user id) یا @username برای اضافه شدن به ادمین‌ها ارسال کن.');
          return;
        }

        if (data === 'ADMIN_REMOVE_ADMIN') {
          config.waitingFor = { type: 'REMOVEADMIN', by: userId }; saveConfig();
          await tg('answerCallbackQuery', { callback_query_id: cb.id });
          await sendMessage(cb.message.chat.id, 'شناسهٔ عددی ادمینی که می‌خواهی حذف شود را ارسال کن.');
          return;
        }

        return;
      }

      // user agreement
      if (data === 'AGREE') {
        // mark user and send VIP link
        if (!users[userId]) {
          // defensive
          users[userId] = { id: userId, first_name: from.first_name || '', last_name: from.last_name || '', username: from.username || '', phone: '', vipSent: false, joinDate: new Date().toISOString() };
        }
        const is_user_admin = isAdmin(userId);
        if (users[userId].vipSent && !is_user_admin) {
          await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '⚠️ شما قبلاً لینک را دریافت کرده‌اید.' });
          return;
        }
        const link = config.vipChannelLink || null;
        if (!link) {
          await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ لینک VIP تنظیم نشده است. با ادمین تماس بگیرید.' });
          return;
        }
        // send link
        await sendMessage(cb.message.chat.id, `🔗 لینک VIP شما:\n${link}`);
        if (!is_user_admin) {
          users[userId].vipSent = true; saveUsers();
        }
        await tg('answerCallbackQuery', { callback_query_id: cb.id });
        return;
      }

      // unknown callback - just answer
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
      return;
    }

  } catch (err) {
    console.error('handleUpdate error', err);
  }
}

// Express app + webhook
const app = express();
app.use(express.json({ limit: '200kb' }));

// webhook endpoint (validate token in path)
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  // Immediately ack 200
  res.sendStatus(200);
  // process update async
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error('update processing failed', e);
  }
});

app.get('/', (req, res) => res.send('NEJJATEBOT running'));
app.get('/healthz', (req, res) => res.send('OK'));

// start server and set webhook
const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(PORT, async () => {
  console.log(`Server running on port: ${PORT}`);
  if (!WEBHOOK_URL) {
    console.warn('WEBHOOK_URL not set - webhook will not be configured. Set WEBHOOK_URL env var to your public URL.');
    return;
  }
  const hook = `${WEBHOOK_URL.replace(/\/$/, '')}/webhook/${BOT_TOKEN}`;
  try {
    // setWebhook
    const res = await tg('setWebhook', { url: hook });
    if (res && res.ok) console.log('Webhook با موفقیت ست شد!');
    else console.warn('setWebhook response:', res);
  } catch (e) {
    console.error('Failed to set webhook:', e.message || e);
  }
});
