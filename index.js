/**
 * NEJJATEBOT - index.js (fixed)
 * - Adds /admin command
 * - Ensures names & username saved
 * - Verifies bot is admin in channel before creating one-time invite
 * - Logs reasons for fallback to static link
 */

const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const { Telegraf } = require('telegraf');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const USERS_FILE = path.join(ROOT, 'users.json');
const SECRET_PATH = '/etc/secrets/bot_token.txt'; // Render secret

// Load config
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

// Load token
let BOT_TOKEN = '';
try {
  BOT_TOKEN = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  if (!BOT_TOKEN) throw new Error('Empty token');
} catch (e) {
  console.error('BOT TOKEN ERROR: ensure Secret File bot_token.txt exists on Render and contains the token.');
  console.error(e.message);
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME || '').replace(/\/$/, '');

// Load users safely
function loadUsersSafe() {
  try {
    if (!fs.pathExistsSync(USERS_FILE)) {
      fs.writeJsonSync(USERS_FILE, []);
      return [];
    }
    const d = fs.readJsonSync(USERS_FILE);
    if (!Array.isArray(d)) {
      fs.writeJsonSync(USERS_FILE, []);
      return [];
    }
    return d;
  } catch (e) {
    console.error('Error reading users.json — resetting to empty array', e.message);
    fs.writeJsonSync(USERS_FILE, []);
    return [];
  }
}
let users = loadUsersSafe();

// Atomic save
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
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// Get bot's own id (cached)
let BOT_ME = null;
async function ensureBotMe() {
  if (!BOT_ME) BOT_ME = await bot.telegram.getMe();
  return BOT_ME;
}

// Check if bot is admin in the channel
async function botIsAdminInChannel(channelId) {
  try {
    const me = await ensureBotMe();
    const member = await bot.telegram.getChatMember(channelId, me.id);
    const status = member && member.status;
    return status === 'administrator' || status === 'creator';
  } catch (e) {
    console.warn('botIsAdminInChannel check failed:', e.message || e);
    return false;
  }
}

// Create one-time invite link safely
async function createOneTimeInviteSafe() {
  if (!config.vipChannelId) {
    console.warn('vipChannelId not set in config.');
    return null;
  }

  // check admin
  const admin = await botIsAdminInChannel(config.vipChannelId);
  if (!admin) {
    console.warn('Bot is NOT admin in channel', config.vipChannelId);
    return null;
  }

  try {
    const res = await bot.telegram.createChatInviteLink(config.vipChannelId, { member_limit: 1 });
    if (res && (res.invite_link || res.link)) return res.invite_link || res.link;
    return null;
  } catch (e) {
    console.warn('createChatInviteLink failed:', e.message || e);
    return null;
  }
}

// START
bot.start(async (ctx) => {
  try {
    const id = ctx.from && ctx.from.id;
    if (!id) return;
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
      console.log('New user added:', id, user.username);
    } else {
      // update profile
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
      saveUsersSafe();
      console.log('User updated on /start:', id, user.username);
    }

    await ctx.reply(config.welcomeMessage || 'سلام');
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

// handle text fallback (keep only for name fallback, otherwise do nothing)
bot.on('text', async (ctx, next) => {
  try {
    const id = ctx.from && ctx.from.id;
    const text = ctx.message && ctx.message.text ? String(ctx.message.text).trim() : '';
    if (!text) return next();
    if (text.startsWith('/')) return next();
    const user = findUser(id);
    if (user && (!user.first_name || user.first_name === '')) {
      const parts = text.split(' ');
      user.first_name = parts[0] || text;
      user.last_name = parts.slice(1).join(' ') || '';
      saveUsersSafe();
      await ctx.reply('نام و نام خانوادگی ذخیره شد. لطفاً شماره را با دکمه ارسال شماره بفرستید.');
      return;
    }
    return next();
  } catch (e) {
    console.error('text handler error', e.message || e);
  }
});

// CONTACT handler
bot.on('contact', async (ctx) => {
  try {
    const id = ctx.from && ctx.from.id;
    const contact = ctx.message && ctx.message.contact;
    if (!id || !contact) return;
    // validate contact belongs to sender (Telegram mobile client usually sets user_id)
    if (contact.user_id && Number(contact.user_id) !== Number(id)) {
      return ctx.reply('لطفاً شمارهٔ خودتان را با دکمه ارسال شماره ارسال کنید.');
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
      console.log('Contact received and new user added:', id, user.username);
    } else {
      user.phone = contact.phone_number || user.phone;
      // also update profile in case changed
      user.first_name = ctx.from.first_name || user.first_name;
      user.last_name = ctx.from.last_name || user.last_name;
      user.username = ctx.from.username || user.username;
      console.log('Contact updated for user:', id, user.username);
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

// Callback: agreement -> send one-time link
bot.on('callback_query', async (ctx) => {
  try {
    const id = ctx.from && ctx.from.id;
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (!data) return ctx.answerCbQuery();
    if (data !== 'AGREE_VIP') return ctx.answerCbQuery();

    const user = findUser(id);
    if (!user) {
      await ctx.reply('خطا: کاربر پیدا نشد. لطفاً /start را بزنید.');
      return ctx.answerCbQuery();
    }
    if (user.vipSent) {
      await ctx.reply('شما قبلاً لینک VIP را دریافت کرده‌اید.');
      return ctx.answerCbQuery();
    }

    // attempt one-time create
    let invite = await createOneTimeInviteSafe();
    if (!invite) {
      console.warn('One-time invite failed. Falling back to vipChannelLink:', config.vipChannelLink);
      invite = config.vipChannelLink || null;
    }

    if (!invite) {
      await ctx.reply('خطا در تهیه لینک VIP. لطفاً ربات را مدیر کانال کن یا لینک ثابت را در تنظیمات قرار ده.');
      return ctx.answerCbQuery();
    }

    await ctx.reply(`لینک VIP شما:\n${invite}`);
    user.vipSent = true;
    saveUsersSafe();
    return ctx.answerCbQuery();
  } catch (e) {
    console.error('callback_query error', e.message || e);
    try { await ctx.answerCbQuery('خطا در پردازش'); } catch {}
  }
});

// ADMIN: menu (responds to /admin)
bot.command('admin', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    const menu = `پنل ادمین:
/listusers - لیست کاربران
/setwelcome <متن> - تغییر پیام خوش‌آمد
/setagreement <متن> - تغییر توافقنامه
/setviplink <لینک> - تغییر لینک fallback
/setvipchannel <@channel_or_id> - تنظیم کانال برای لینک یک‌بارمصرف`;
    return ctx.reply(menu);
  } catch (e) {
    console.error('/admin error', e.message || e);
  }
});

// ADMIN: list users
bot.command('listusers', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    if (!users || users.length === 0) return ctx.reply('هیچ کاربری ثبت نشده است.');
    const lines = users.map(u => `${u.id} | ${u.first_name || ''} ${u.last_name || ''} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | ${u.joinDate || '-'} | vip:${u.vipSent ? '✅' : '❌'}`);
    const parts = chunkText(lines.join('\n'), 3500);
    for (const p of parts) await ctx.reply(p);
  } catch (e) {
    console.error('listusers error', e.message || e);
    await ctx.reply('خطا هنگام بازیابی لیست کاربران.');
  }
});

// ADMIN: setwelcome
bot.command('setwelcome', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    const newText = ctx.message.text.replace('/setwelcome', '').trim();
    if (!newText) return ctx.reply('فرمت: /setwelcome متن جدید');
    config.welcomeMessage = newText;
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
    return ctx.reply('متن خوش‌آمدگویی به‌روز شد.');
  } catch (e) {
    console.error('setwelcome error', e.message || e);
    return ctx.reply('خطا هنگام ذخیره متن خوش‌آمد.');
  }
});

// ADMIN: setagreement
bot.command('setagreement', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    const newText = ctx.message.text.replace('/setagreement', '').trim();
    if (!newText) return ctx.reply('فرمت: /setagreement متن جدید');
    config.agreementText = newText;
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
    return ctx.reply('متن توافقنامه به‌روز شد.');
  } catch (e) {
    console.error('setagreement error', e.message || e);
    return ctx.reply('خطا هنگام ذخیره متن توافقنامه.');
  }
});

// ADMIN: setviplink
bot.command('setviplink', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    const newText = ctx.message.text.replace('/setviplink', '').trim();
    if (!newText) return ctx.reply('فرمت: /setviplink https://...');
    config.vipChannelLink = newText;
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
    return ctx.reply('لینک VIP ثابت به‌روز شد.');
  } catch (e) {
    console.error('setviplink error', e.message || e);
    return ctx.reply('خطا هنگام ذخیره لینک VIP.');
  }
});

// ADMIN: setvipchannel
bot.command('setvipchannel', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
    const newText = ctx.message.text.replace('/setvipchannel', '').trim();
    if (!newText) return ctx.reply('فرمت: /setvipchannel @channelusername یا numeric id');
    config.vipChannelId = newText;
    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
    return ctx.reply('vipChannelId به‌روزرسانی شد (برای لینک یک‌بارمصرف).');
  } catch (e) {
    console.error('setvipchannel error', e.message || e);
    return ctx.reply('خطا هنگام ذخیره vipChannelId.');
  }
});

// health
app.get('/healthz', (req, res) => res.send('OK'));

// webhook handler
app.use(bot.webhookCallback('/bot'));

// start server and set webhook
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (!WEBHOOK_URL) {
    console.error('WEBHOOK_URL not set. Set WEBHOOK_URL env var to your public URL (e.g., https://nejjatebot.onrender.com)');
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

// global errors
process.on('unhandledRejection', (r) => console.error('Unhandled Rejection:', r));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
