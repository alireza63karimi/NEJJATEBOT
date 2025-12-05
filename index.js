/**
 * NEJJATEBOT - index.js (Ready for Render)
 * - Admins can test VIP link multiple times
 * - Saves names, username, phone
 * - One-time invite for normal users
 * - Webhook mode
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
  welcomeMessage: 'هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید',
  agreementText: 'من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم',
  vipChannelId: '',
  vipChannelLink: 'https://t.me/NEJJATE_VIP',
  adminIds: [6043389836, 188225902]
};
try {
  const cfg = fs.readJsonSync(CONFIG_FILE);
  config = { ...config, ...cfg };
} catch (e) {
  console.warn('config.json not found or invalid, using defaults');
}

// Load bot token
let BOT_TOKEN = '';
try {
  BOT_TOKEN = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  if (!BOT_TOKEN) throw new Error('Empty token');
} catch (e) {
  console.error('BOT TOKEN ERROR:', e.message);
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME || '').replace(/\/$/, '');

// Users
let users = [];
try {
  if (fs.existsSync(USERS_FILE)) users = fs.readJsonSync(USERS_FILE);
} catch (e) {
  console.warn('users.json invalid, resetting');
  users = [];
}

function saveUsers() {
  try {
    fs.writeJsonSync(USERS_FILE + '.tmp', users, { spaces: 2 });
    fs.moveSync(USERS_FILE + '.tmp', USERS_FILE, { overwrite: true });
  } catch (e) {
    console.error('Failed to save users.json', e.message);
  }
}

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

// Bot ID cache
let BOT_ME = null;
async function ensureBotMe() { if (!BOT_ME) BOT_ME = await bot.telegram.getMe(); return BOT_ME; }
async function botIsAdminInChannel(channelId) {
  try {
    const me = await ensureBotMe();
    const member = await bot.telegram.getChatMember(channelId, me.id);
    return member && (member.status === 'administrator' || member.status === 'creator');
  } catch (e) { console.warn('botIsAdminInChannel failed:', e.message); return false; }
}

async function createOneTimeInvite() {
  if (!config.vipChannelId) return null;
  if (!(await botIsAdminInChannel(config.vipChannelId))) {
    console.warn('Bot is not admin in channel', config.vipChannelId);
    return null;
  }
  try {
    const res = await bot.telegram.createChatInviteLink(config.vipChannelId, { member_limit: 1 });
    return res && (res.invite_link || res.link);
  } catch (e) {
    console.warn('createChatInviteLink failed:', e.message);
    return null;
  }
}

// START
bot.start(async (ctx) => {
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
    saveUsers();
  } else {
    user.first_name = ctx.from.first_name || user.first_name;
    user.last_name = ctx.from.last_name || user.last_name;
    user.username = ctx.from.username || user.username;
    saveUsers();
  }
  await ctx.reply(config.welcomeMessage);
  await ctx.reply('برای ارسال شماره، دکمه زیر را بزنید:', {
    reply_markup: { keyboard: [[{ text: 'ارسال شماره 📱', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
  });
});

// Text fallback for name
bot.on('text', async (ctx, next) => {
  const id = ctx.from.id;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return next();
  const user = findUser(id);
  if (user && (!user.first_name || user.first_name === '')) {
    const parts = text.split(' ');
    user.first_name = parts[0];
    user.last_name = parts.slice(1).join(' ');
    saveUsers();
    await ctx.reply('نام و نام خانوادگی ذخیره شد. لطفاً شماره را با دکمه ارسال شماره بفرستید.');
  } else next();
});

// CONTACT
bot.on('contact', async (ctx) => {
  const id = ctx.from.id;
  const contact = ctx.message.contact;
  if (!contact) return;
  if (contact.user_id && Number(contact.user_id) !== Number(id)) {
    return ctx.reply('لطفاً شمارهٔ خودتان را با دکمه ارسال شماره ارسال کنید.');
  }
  let user = findUser(id);
  if (!user) {
    user = { id, first_name: ctx.from.first_name, last_name: ctx.from.last_name, username: ctx.from.username, phone: contact.phone_number, vipSent: false, joinDate: new Date().toISOString() };
    users.push(user);
  } else {
    user.phone = contact.phone_number;
    user.first_name = ctx.from.first_name || user.first_name;
    user.last_name = ctx.from.last_name || user.last_name;
    user.username = ctx.from.username || user.username;
  }
  saveUsers();
  await ctx.reply(config.agreementText, { reply_markup: { inline_keyboard: [[{ text: 'تایید میکنم ✅', callback_data: 'AGREE_VIP' }]] } });
});

// CALLBACK QUERY
bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const data = ctx.callbackQuery.data;
  if (data !== 'AGREE_VIP') return ctx.answerCbQuery();
  const user = findUser(id);
  if (!user) { await ctx.reply('خطا: کاربر پیدا نشد. لطفاً /start بزنید.'); return ctx.answerCbQuery(); }

  const is_user_admin = isAdmin(id);
  if (user.vipSent && !is_user_admin) { await ctx.reply('شما قبلاً لینک VIP را دریافت کرده‌اید.'); return ctx.answerCbQuery(); }

  let invite = await createOneTimeInvite();
  if (!invite) invite = config.vipChannelLink;
  if (!invite) { await ctx.reply('خطا در تهیه لینک VIP'); return ctx.answerCbQuery(); }

  await ctx.reply(`لینک VIP شما:\n${invite}`);
  if (!is_user_admin) { user.vipSent = true; saveUsers(); }
  return ctx.answerCbQuery();
});

// ADMIN /admin
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const menu = `پنل ادمین:
/listusers - لیست کاربران
/setwelcome <متن> - تغییر پیام خوش‌آمد
/setagreement <متن> - تغییر توافقنامه
/setviplink <لینک> - تغییر لینک fallback
/setvipchannel <@channel_or_id> - تنظیم کانال برای لینک یک‌بارمصرف`;
  await ctx.reply(menu);
});

// ADMIN commands
bot.command('listusers', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  if (!users.length) return ctx.reply('هیچ کاربری ثبت نشده است.');
  const lines = users.map(u => `${u.id} | ${u.first_name} ${u.last_name} | ${u.username ? '@'+u.username : '-'} | ${u.phone || '-'} | ${u.joinDate} | vip:${u.vipSent?'✅':'❌'}`);
  for (const p of chunkText(lines.join('\n'))) await ctx.reply(p);
});

bot.command('setwelcome', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setwelcome', '').trim();
  if (!newText) return ctx.reply('فرمت: /setwelcome متن جدید');
  config.welcomeMessage = newText; fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); await ctx.reply('متن خوش‌آمد به‌روز شد.');
});

bot.command('setagreement', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setagreement', '').trim();
  if (!newText) return ctx.reply('فرمت: /setagreement متن جدید');
  config.agreementText = newText; fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); await ctx.reply('متن توافقنامه به‌روز شد.');
});

bot.command('setviplink', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setviplink', '').trim();
  if (!newText) return ctx.reply('فرمت: /setviplink https://...');
  config.vipChannelLink = newText; fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); await ctx.reply('لینک VIP ثابت به‌روز شد.');
});

bot.command('setvipchannel', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  const newText = ctx.message.text.replace('/setvipchannel', '').trim();
  if (!newText) return ctx.reply('فرمت: /setvipchannel @channel_or_id');
  config.vipChannelId = newText; fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 }); await ctx.reply('vipChannelId به‌روز شد.');
});

// Health
app.get('/healthz', (req, res) => res.send('OK'));

// Webhook
app.use(bot.webhookCallback('/bot'));

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (!WEBHOOK_URL) { console.error('WEBHOOK_URL not set'); process.exit(1); }
  const hook = `${WEBHOOK_URL}/bot`;
  try { await bot.telegram.deleteWebhook(); } catch {}
  try { await bot.telegram.setWebhook(hook); console.log('Webhook set to', hook); } catch(e){ console.error(e.message); process.exit(1);}
  console.log('Bot ready.');
});

// Global errors
process.on('unhandledRejection', r => console.error('Unhandled Rejection:', r));
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));
