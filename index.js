const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const ROOT = __dirname;

const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');

// Load config & users safely
function loadJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) fs.writeJsonSync(file, fallback, { spaces: 2 });
    return fs.readJsonSync(file);
  } catch (e) {
    fs.writeJsonSync(file, fallback, { spaces: 2 });
    return fallback;
  }
}

let config = loadJsonSafe(CONFIG_FILE, {
  welcomeMessage: "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید",
  agreementText: "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
  agreementButton: "تایید میکنم ✅",
  vipChannelLink: "https://t.me/NEJJATE_VIP",
  admins: [],
  waitingFor: null,
  vipSendMode: "manual",
  manualVipLinks: { current: "" }
});

let users = loadJsonSafe(USERS_FILE, {});

function saveConfig() { fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); }
function saveUsers() { fs.writeJsonSync(USERS_FILE, users, { spaces: 2 }); }

// Read BOT_TOKEN & WEBHOOK_URL from Environment Variables or Secret File
let BOT_TOKEN = process.env.BOT_TOKEN || '';
if (!BOT_TOKEN) {
  const SECRET_FILE = '/etc/secrets/bot_token.txt';
  if (fs.existsSync(SECRET_FILE)) BOT_TOKEN = fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

if (!BOT_TOKEN) { console.error('❌ توکن ربات پیدا نشد!'); process.exit(1); }
if (!WEBHOOK_URL) console.warn('⚠️ WEBHOOK_URL تنظیم نشده است!');

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function sendMessage(chat_id, text, extra = {}) {
  const payload = Object.assign({ chat_id, text, parse_mode: 'HTML' }, extra);
  return await tg('sendMessage', payload);
}

function contactKeyboard() {
  return { reply_markup: JSON.stringify({ keyboard: [[{ text: "ارسال شماره 📱", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }) };
}

function isAdmin(userId) { return config.admins.includes(String(userId)); }

// Send VIP link to user (manual/auto)
async function sendVipLinkToUser(userId, chatId) {
  if (!users[userId]) users[userId] = { id: userId, vipSent: false };
  if (users[userId].vipSent && !isAdmin(userId)) {
    await tg('answerCallbackQuery', { callback_query_id: chatId, text: '⚠️ شما قبلاً لینک را دریافت کرده‌اید.' });
    return;
  }

  let link = config.vipSendMode === 'auto' ? config.vipChannelLink : config.manualVipLinks.current;
  if (!link) {
    await tg('answerCallbackQuery', { callback_query_id: chatId, text: '❌ لینک VIP هنوز توسط ادمین ثبت نشده است.' });
    return;
  }

  await sendMessage(chatId, `🔗 لینک VIP شما:\n${link}`);
  if (!isAdmin(userId)) { users[userId].vipSent = true; saveUsers(); }
  await tg('answerCallbackQuery', { callback_query_id: chatId });
}

// Handle incoming updates
async function handleUpdate(update) {
  try {
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const userId = String(msg.from.id);

      if (!users[userId]) users[userId] = { id: userId, first_name: msg.from.first_name, last_name: msg.from.last_name, username: msg.from.username, phone: '', vipSent: false, joinDate: new Date().toISOString() };
      else { users[userId].first_name = msg.from.first_name; users[userId].last_name = msg.from.last_name; users[userId].username = msg.from.username; }

      saveUsers();

      const text = msg.text?.trim();

      if (text === '/start') {
        await sendMessage(chatId, config.welcomeMessage);
        await sendMessage(chatId, 'برای ارسال شماره، دکمه زیر را بزنید:', contactKeyboard());
        return;
      }

      if (text?.toLowerCase() === '/admin') {
        if (!isAdmin(userId)) { await sendMessage(chatId, '⛔ شما ادمین نیستید.'); return; }

        const keyboard = { reply_markup: JSON.stringify({
          inline_keyboard: [
            [{ text: '✏️ تغییر پیام خوش‌آمد', callback_data: 'ADMIN_EDIT_WELCOME' }, { text: '📝 تغییر متن توافقنامه', callback_data: 'ADMIN_EDIT_AGREEMENT' }],
            [{ text: '🔗 تغییر لینک VIP', callback_data: 'ADMIN_EDIT_VIP' }, { text: '👥 مشاهده کاربران', callback_data: 'ADMIN_LIST_USERS' }],
            [{ text: '➕ اضافه کردن ادمین', callback_data: 'ADMIN_ADD_ADMIN' }, { text: '➖ حذف ادمین', callback_data: 'ADMIN_REMOVE_ADMIN' }]
          ]
        })};
        await sendMessage(chatId, 'پنل مدیریت:', keyboard);
        return;
      }

      if (msg.contact) {
        if (msg.contact.user_id && String(msg.contact.user_id) !== userId) { await sendMessage(chatId, 'لطفاً شمارهٔ خودتان را ارسال کنید.'); return; }
        users[userId].phone = msg.contact.phone_number; saveUsers();
        await sendMessage(chatId, config.agreementText, {
          reply_markup: JSON.stringify({ inline_keyboard: [[{ text: config.agreementButton, callback_data: 'AGREE' }]] })
        });
        return;
      }
    }

    if (update.callback_query) {
      const cb = update.callback_query;
      const userId = String(cb.from.id);
      const data = cb.data;

      if (data === 'AGREE') { await sendVipLinkToUser(userId, cb.message.chat.id); return; }

      if (data.startsWith('ADMIN_') && isAdmin(userId)) {
        const chatId = cb.message.chat.id;
        switch (data) {
          case 'ADMIN_EDIT_WELCOME': config.waitingFor = { type: 'WELCOME', by: userId }; saveConfig(); await sendMessage(chatId, 'لطفاً متن جدید خوش‌آمد را ارسال کنید.'); break;
          case 'ADMIN_EDIT_AGREEMENT': config.waitingFor = { type: 'AGREEMENT', by: userId }; saveConfig(); await sendMessage(chatId, 'لطفاً متن جدید توافقنامه را ارسال کنید.'); break;
          case 'ADMIN_EDIT_VIP': config.waitingFor = { type: 'VIP', by: userId }; saveConfig(); await sendMessage(chatId, 'لطفاً لینک جدید VIP را وارد کنید.'); break;
          case 'ADMIN_LIST_USERS':
            const lines = Object.values(users).map(u => `${u.id} | ${u.first_name} ${u.last_name} | ${u.username || '-'} | ${u.phone || '-'} | vip:${u.vipSent?'✅':'❌'}`).join('\n');
            const parts = lines.match(/.{1,3000}/g) || [];
            for (const p of parts) await sendMessage(chatId, p);
            break;
          case 'ADMIN_ADD_ADMIN': config.waitingFor = { type: 'ADDADMIN', by: userId }; saveConfig(); await sendMessage(chatId, 'شناسه یا یوزرنیم ادمین جدید را وارد کنید.'); break;
          case 'ADMIN_REMOVE_ADMIN': config.waitingFor = { type: 'REMOVEADMIN', by: userId }; saveConfig(); await sendMessage(chatId, 'شناسه ادمین را وارد کنید.'); break;
        }
        await tg('answerCallbackQuery', { callback_query_id: cb.id });
      }
    }
  } catch (err) { console.error(err); }
}

// Express app + webhook
const app = express();
app.use(express.json({ limit: '200kb' }));

app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => { res.sendStatus(200); await handleUpdate(req.body); });
app.get('/', (req, res) => res.send('NEJJATEBOT running'));
app.get('/healthz', (req, res) => res.send('OK'));

const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(PORT, async () => {
  console.log(`Server running on port: ${PORT}`);
  if (!WEBHOOK_URL) return;
  try {
    const hook = `${WEBHOOK_URL.replace(/\/$/, '')}/webhook/${BOT_TOKEN}`;
    const res = await tg('setWebhook', { url: hook });
    if (res?.ok) console.log('Webhook با موفقیت ست شد!');
    else console.warn('setWebhook response:', res);
  } catch (e) { console.error('Failed to set webhook:', e); }
});
