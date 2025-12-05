/**
 * NEJJATEBOT - index.js
 * Webhook-based Telegraf bot for Render
 *
 * Features:
 * - welcome message (editable by admin)
 * - collects profile name/username, contact phone (Contact button)
 * - shows agreement and requires user to press "تایید میکنم"
 * - issues one-time invite (if vipChannelId set and bot is admin there) else fallback link
 * - stores users in users.json with joinDate and vipSent
 * - admin commands to change texts and view users
 *
 * Requirements on Render:
 * - Secret File: bot_token.txt  (content = BOT TOKEN)
 * - Environment variable: WEBHOOK_URL = https://your-service.onrender.com
 *
 */

const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const { Telegraf } = require('telegraf');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');

// ---- load config safely ----
let config = {};
try {
  config = fs.readJsonSync(CONFIG_FILE);
} catch (err) {
  console.error('Cannot read config.json or invalid JSON:', err.message || err);
  process.exit(1);
}

// ---- load token from Secret File (Render puts secret files under /etc/secrets) ----
const SECRET_PATH = '/etc/secrets/bot_token.txt';
let BOT_TOKEN;
try {
  BOT_TOKEN = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  if (!BOT_TOKEN) throw new Error('Empty token');
} catch (err) {
  console.error('BOT TOKEN ERROR: ensure you created a Secret File named bot_token.txt on Render and it contains the token (no newline).');
  console.error(err.message || err);
  process.exit(1);
}

// ---- Telegraf (webhook mode: we will not use polling) ----
const bot = new Telegraf(BOT_TOKEN);

// ---- Express setup for webhook + health ----
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME || '').replace(/\/$/, '');
if (!WEBHOOK_URL) {
  console.error('WEBHOOK_URL not set. Set WEBHOOK_URL env var on Render to your public service URL (e.g., https://nejjatebot.onrender.com)');
  // continue but will exit later when trying to set webhook
}

// ---- load or init users ----
let users = [];
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeJsonSync(USERS_FILE, []);
      return [];
    }
    const data = fs.readJsonSync(USERS_FILE);
    if (!Array.isArray(data)) {
      fs.writeJsonSync(USERS_FILE, []);
      return [];
    }
    return data;
  } catch (e) {
    console.error('Failed to load users.json — resetting file', e.message || e);
    fs.writeJsonSync(USERS_FILE, []);
    return [];
  }
}
function saveUsers() {
  try {
    fs.writeJsonSync(USERS_FILE, users, { spaces: 2 });
  } catch (e) {
    console.error('Failed to save users.json', e.message || e);
  }
}
users = loadUsers();

// ---- helpers ----
function isAdmin(id) {
  return Array.isArray(config.adminIds) && config.adminIds.includes(Number(id));
}
function findUserById(id) {
  return users.find(u => Number(u.id) === Number(id));
}
function chunkify(text, size = 3500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

// ---- create one-time invite if possible ----
async function createOneTimeInvite() {
  if (!config.vipChannelId) return null;
  try {
    // member_limit = 1 => one person can join with this link
    const res = await bot.telegram.createChatInviteLink(config.vipChannelId, { member_limit: 1 });
    // res may be object with invite_link prop
    if (res && (res.invite_link || res.link || res)) {
      return res.invite_link || res.link || res;
    }
    return null;
  } catch (e) {
    console.warn('createChatInviteLink failed (bot must be admin in channel and vipChannelId must be correct). Error:', e.message || e);
    return null;
  }
}

// ---- Handlers ----

// /start
bot.start(async (ctx) => {
  try {
    const id = ctx.from.id;
    let user = findUserById(id);
    if (!user) {
      user = {
        id,
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || '',
        username: ctx.from.username || '',
        phone: null,
        joinedAt: new Date().toISOString(),
        vipSent: false
      };
      users.push(user);
      saveUsers();
    } else {
      // update profile fields in case user changed username/name
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
      saveUsers();
    }

    // send welcome
    await ctx.reply(config.welcomeMessage || 'سلام');
    // ask for contact via keyboard (works on mobile clients)
    await ctx.reply('برای دریافت لینک VIP لطفاً دکمه ارسال شماره را بزنید:', {
      reply_markup: {
        keyboard: [[{ text: 'ارسال شماره 📱', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  } catch (e) {
    console.error('/start error', e.message || e);
  }
});

// text handler — used to accept name if user types it manually (fallback)
bot.on('text', async (ctx, next) => {
  try {
    const id = ctx.from.id;
    const text = ctx.message && ctx.message.text ? String(ctx.message.text).trim() : '';
    // ignore admin commands here
    if (text.startsWith('/')) return next();
    // if user exists but no first_name stored (edge cases), treat this as name
    const user = findUserById(id);
    if (user && (!user.first_name || user.first_name === '')) {
      const parts = text.split(' ');
      user.first_name = parts[0] || text;
      user.last_name = parts.slice(1).join(' ') || '';
      saveUsers();
      await ctx.reply('نام ثبت شد. لطفاً شماره را از دکمه ارسال شماره بفرستید.');
      return;
    }
    return next();
  } catch (e) {
    console.error('text handler error', e.message || e);
  }
});

// contact handler
bot.on('contact', async (ctx) => {
  try {
    const contact = ctx.message && ctx.message.contact;
    if (!contact) return;
    const id = ctx.from.id;
    // validate that the contact belongs to the sender (mobile client sends contact.user_id)
    if (contact.user_id && Number(contact.user_id) !== Number(id)) {
      return ctx.reply('لطفاً شماره تلگرام خودتان را ارسال کنید (دکمه ارسال شماره را بزنید).');
    }
    let user = findUserById(id);
    if (!user) {
      user = {
        id,
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || '',
        username: ctx.from.username || '',
        phone: contact.phone_number || '',
        joinedAt: new Date().toISOString(),
        vipSent: false
      };
      users.push(user);
    } else {
      user.phone = contact.phone_number || user.phone;
      // update profile info
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
    }
    saveUsers();

    // send agreement inline button
    await ctx.reply(config.agreementText || 'لطفاً توافقنامه را تایید کنید.', {
      reply_markup: {
        inline_keyboard: [[{ text: 'تایید میکنم ✅', callback_data: 'AGREE_VIP' }]]
      }
    });
  } catch (e) {
    console.error('contact handler error', e.message || e);
  }
});

// callback_query handler (agreement)
bot.on('callback_query', async (ctx) => {
  try {
    const id = ctx.from.id;
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (!data) return ctx.answerCbQuery();

    if (data === 'AGREE_VIP') {
      const user = findUserById(id);
      if (!user) {
        await ctx.reply('خطا: کاربر پیدا نشد. لطفاً /start بزنید.');
        return ctx.answerCbQuery();
      }
      if (user.vipSent) {
        await ctx.reply('شما قبلاً لینک VIP را دریافت کرده‌اید.');
        return ctx.answerCbQuery();
      }

      // create one-time invite if possible; else use fallback link
      let invite = null;
      invite = await createOneTimeInvite();
      if (!invite && config.vipChannelLink) invite = config.vipChannelLink;
      if (!invite) {
        await ctx.reply('خطا در تهیه لینک VIP، لطفاً بعداً تلاش کنید.');
        return ctx.answerCbQuery();
      }

      await ctx.reply(`لینک VIP شما:\n${invite}`);
      user.vipSent = true;
      saveUsers();
      return ctx.answerCbQuery();
    }

    return ctx.answerCbQuery();
  } catch (e) {
    console.error('callback_query error', e.message || e);
    try { await ctx.answerCbQuery('خطا'); } catch {}
  }
});

// Admin commands: simple commands to change config or view users
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const menu = `پنل ادمین:
- /setwelcome متن جدید
- /setagreement متن جدید
- /setviplink لینک ثابت
- /setvipchannel @channel_or_id
- /listusers`;
  return ctx.reply(menu);
});

bot.command('setwelcome', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setwelcome', '').trim();
  if (!newText) return ctx.reply('فرمت: /setwelcome متن جدید');
  config.welcomeMessage = newText;
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  return ctx.reply('متن خوش‌آمدگویی به‌روز شد.');
});

bot.command('setagreement', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setagreement', '').trim();
  if (!newText) return ctx.reply('فرمت: /setagreement متن جدید');
  config.agreementText = newText;
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  return ctx.reply('متن توافقنامه به‌روز شد.');
});

bot.command('setviplink', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setviplink', '').trim();
  if (!newText) return ctx.reply('فرمت: /setviplink https://...');
  config.vipChannelLink = newText;
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  return ctx.reply('لینک VIP ثابت به‌روز شد.');
});

bot.command('setvipchannel', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setvipchannel', '').trim();
  if (!newText) return ctx.reply('فرمت: /setvipchannel @channelusername یا numeric id');
  config.vipChannelId = newText;
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
  return ctx.reply('vipChannelId به‌روزرسانی شد (برای لینک یکبار مصرف).');
});

bot.command('listusers', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  try {
    if (!users || users.length === 0) return ctx.reply('هیچ کاربری ثبت نشده است.');
    const lines = users.map(u => `${u.id} | ${u.first_name || ''} ${u.last_name || ''} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | ${u.joinedAt || '-'} | vip:${u.vipSent ? '✅' : '❌'}`);
    const bigText = lines.join('\n');
    const parts = chunkify(bigText, 3500);
    for (const p of parts) await ctx.reply(p);
  } catch (e) {
    console.error('listusers error', e.message || e);
    await ctx.reply('خطا هنگام بازیابی کاربران.');
  }
});

// ---- Express endpoints ----
app.get('/healthz', (req, res) => res.send('OK'));
app.use(bot.webhookCallback('/bot'));

// ---- Start server and set webhook (delete existing webhook to avoid conflict) ----
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  if (!WEBHOOK_URL) {
    console.error('WEBHOOK_URL not set. Set WEBHOOK_URL env var to your public URL (e.g., https://yourapp.onrender.com)');
    process.exit(1);
  }

  const hookUrl = `${WEBHOOK_URL.replace(/\/$/, '')}/bot`;

  try {
    await bot.telegram.deleteWebhook();
    console.log('Previous webhook deleted (if any).');
  } catch (e) {
    console.warn('deleteWebhook warning:', e.message || e);
  }

  try {
    await bot.telegram.setWebhook(hookUrl);
    console.log('Webhook set to', hookUrl);
  } catch (e) {
    console.error('Failed to set webhook:', e.message || e);
    process.exit(1);
  }

  console.log('Bot ready (webhook mode).');
});
