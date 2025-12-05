/**
 * NEJJATEBOT - index.js
 * Ready for Render (webhook mode). Requirements:
 *  - Secret File on Render: bot_token.txt  (content = BOT TOKEN)
 *  - Environment variable: WEBHOOK_URL = https://your-service.onrender.com
 *  - Bot must be admin in @NEJJATE_VIP to create one-time invites
 */

const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const { Telegraf } = require('telegraf');

// Files
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');
const SECRET_PATH = '/etc/secrets/bot_token.txt'; // Render Secret File path

// Load config safely
let config = {
  welcomeMessage: '',
  agreementText: '',
  vipChannelId: '',
  vipChannelLink: '',
  adminIds: []
};
try {
  config = fs.readJsonSync(CONFIG_FILE);
  if (!Array.isArray(config.adminIds)) config.adminIds = [];
} catch (e) {
  console.error('Cannot read config.json or invalid JSON:', e.message);
  process.exit(1);
}

// Load bot token from secret file (Render)
let BOT_TOKEN = '';
try {
  BOT_TOKEN = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  if (!BOT_TOKEN) throw new Error('Empty token');
} catch (e) {
  console.error('BOT TOKEN ERROR: ensure Secret File bot_token.txt exists on Render and contains the token.');
  console.error(e.message);
  process.exit(1);
}

// Telegraf bot (webhook mode)
const bot = new Telegraf(BOT_TOKEN);

// Express setup
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME || '').replace(/\/$/, '');

// Safety: load or init users file
function loadUsersSafe() {
  try {
    if (!fs.pathExistsSync(USERS_FILE)) {
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
    console.error('Error reading users.json — resetting to empty array', e.message);
    fs.writeJsonSync(USERS_FILE, []);
    return [];
  }
}
let users = loadUsersSafe();

// Atomic save to avoid race conditions
function saveUsersSafe() {
  try {
    fs.writeJsonSync(USERS_FILE + '.tmp', users, { spaces: 2 });
    fs.moveSync(USERS_FILE + '.tmp', USERS_FILE, { overwrite: true });
  } catch (e) {
    console.error('Failed to save users.json', e.message);
  }
}

// Helpers
function isAdmin(id) {
  return Array.isArray(config.adminIds) && config.adminIds.includes(Number(id));
}
function findUser(id) {
  return users.find(u => Number(u.id) === Number(id));
}
function chunkText(text, size = 3500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

// Create one-time invite (preferred) using createChatInviteLink
async function createOneTimeInvite() {
  if (!config.vipChannelId) return null;
  try {
    // Use createChatInviteLink with member_limit=1
    const res = await bot.telegram.createChatInviteLink(config.vipChannelId, { member_limit: 1 });
    // res may be object with invite_link
    return res && (res.invite_link || res.link || res); 
  } catch (e) {
    console.warn('createChatInviteLink failed (bot must be admin, vipChannelId correct):', e.message || e);
    return null;
  }
}

// START
bot.start(async (ctx) => {
  try {
    const id = ctx.from.id;
    let user = findUser(id);
    if (!user) {
      user = {
        id,
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || '',
        username: ctx.from.username || '',
        phone: '',
        vipSent: false,
        joinDate: new Date().toISOString()
      };
      users.push(user);
      saveUsersSafe();
    } else {
      // update profile fields (user may have changed)
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
      saveUsersSafe();
    }

    await ctx.reply(config.welcomeMessage || 'سلام');
    // ask for contact button
    await ctx.reply('برای ارسال شماره، دکمه زیر را بزنید:', {
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

// Handle text fallback (if user types name)
bot.on('text', async (ctx, next) => {
  try {
    const id = ctx.from.id;
    const text = ctx.message.text ? String(ctx.message.text).trim() : '';
    if (text.startsWith('/')) return next();
    const user = findUser(id);
    if (user && (!user.first_name || user.first_name === '')) {
      const parts = text.split(' ');
      user.first_name = parts[0] || text;
      user.last_name = parts.slice(1).join(' ') || '';
      saveUsersSafe();
      await ctx.reply('نام ذخیره شد. لطفاً شماره را با دکمه ارسال شماره بفرستید.');
      return;
    }
    return next();
  } catch (e) {
    console.error('text handler error', e.message || e);
  }
});

// CONTACT handler — validate contact.user_id
bot.on('contact', async (ctx) => {
  try {
    const id = ctx.from.id;
    const contact = ctx.message.contact;
    if (!contact) return;
    if (contact.user_id && Number(contact.user_id) !== Number(id)) {
      return ctx.reply('لطفاً شمارهٔ خودتان را ارسال کنید (دکمه ارسال شماره را بزنید).');
    }
    let user = findUser(id);
    if (!user) {
      user = {
        id,
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || '',
        username: ctx.from.username || '',
        phone: contact.phone_number || '',
        vipSent: false,
        joinDate: new Date().toISOString()
      };
      users.push(user);
    } else {
      user.phone = contact.phone_number || user.phone;
    }
    saveUsersSafe();

    await ctx.reply(config.agreementText || 'لطفاً توافقنامه را تایید کنید.', {
      reply_markup: {
        inline_keyboard: [[{ text: 'تایید میکنم ✅', callback_data: 'AGREE_VIP' }]]
      }
    });
  } catch (e) {
    console.error('contact handler error', e.message || e);
  }
});

// Callback query: agreement -> issue link
bot.on('callback_query', async (ctx) => {
  try {
    const id = ctx.from.id;
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (!data) return ctx.answerCbQuery();
    if (data !== 'AGREE_VIP') return ctx.answerCbQuery();

    const user = findUser(id);
    if (!user) {
      await ctx.reply('خطا: کاربر پیدا نشد، لطفاً /start بزنید.');
      return ctx.answerCbQuery();
    }
    if (user.vipSent) {
      await ctx.reply('شما قبلاً لینک VIP را دریافت کرده‌اید.');
      return ctx.answerCbQuery();
    }

    // try create one-time invite
    let invite = await createOneTimeInvite();
    if (!invite) invite = config.vipChannelLink || null;
    if (!invite) {
      await ctx.reply('خطا در تهیه لینک VIP. لطفاً ربات را مدیر کانال کن یا لینک VIP را در تنظیمات قرار ده.');
      return ctx.answerCbQuery();
    }

    await ctx.reply(`لینک VIP شما:\n${invite}`);
    user.vipSent = true;
    saveUsersSafe();
    return ctx.answerCbQuery();
  } catch (e) {
    console.error('callback_query error', e.message || e);
    try { await ctx.answerCbQuery('خطا'); } catch {}
  }
});

// ADMIN: list users (chunked)
bot.command('listusers', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    if (!users || users.length === 0) return ctx.reply('هیچ کاربری ثبت نشده است.');
    const lines = users.map(u => `${u.id} | ${u.first_name || ''} ${u.last_name || ''} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | ${u.joinDate || '-'} | vip:${u.vipSent ? '✅' : '❌'}`);
    const text = lines.join('\n');
    const parts = chunkText(text, 3500);
    for (const p of parts) await ctx.reply(p);
  } catch (e) {
    console.error('listusers error', e.message || e);
    await ctx.reply('خطا هنگام بازیابی لیست کاربران.');
  }
});

// ADMIN commands to update texts/links
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
  return ctx.reply('vipChannelId به‌روزرسانی شد (برای لینک یک‌بارمصرف).');
});

// Health endpoint
app.get('/healthz', (req, res) => res.send('OK'));

// attach webhook handler
app.use(bot.webhookCallback('/bot'));

// Start server and set webhook (delete previous to avoid conflict)
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (!WEBHOOK_URL) {
    console.error('WEBHOOK_URL not set. Set WEBHOOK_URL env var to your public URL (e.g., https://yourapp.onrender.com)');
    process.exit(1);
  }
  const hook = `${WEBHOOK_URL}/bot`;
  try {
    await bot.telegram.deleteWebhook();
    console.log('Previous webhook deleted (if any).');
  } catch (e) {
    console.warn('deleteWebhook warning:', e.message || e);
  }
  try {
    await bot.telegram.setWebhook(hook);
    console.log('Webhook set to', hook);
  } catch (e) {
    console.error('Failed to set webhook:', e.message || e);
    process.exit(1);
  }
  console.log('Bot ready (webhook mode).');
});

// Global error handling
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
