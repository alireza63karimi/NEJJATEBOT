// index.js
// NEJJATEBOT - نسخه نهایی فقط با Polling
// نیازمندی‌ها: npm install telegraf express

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN_PATH = path.join(__dirname, 'bot_token.txt');
let BOT_TOKEN = '';
try {
  BOT_TOKEN = fs.readFileSync(BOT_TOKEN_PATH, 'utf8').trim();
} catch (e) {
  console.error('فایل bot_token.txt یافت نشد. لطفاً در Render بسازید.');
  process.exit(1);
}
if (!BOT_TOKEN) {
  console.error('توکن خالی است.');
  process.exit(1);
}

// خواندن config
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {
  botUsername: '@NEJJATEBOT',
  vipChannelUsername: '@NEJJATE_VIP',
  vipChannelId: '',
  welcomeMessage: 'هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید',
  agreementText: 'من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم',
  adminIds: [6043389836, 188225902],
  fallbackVipLink: ''
};
try {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = { ...config, ...JSON.parse(raw) };
} catch (e) {
  console.warn('هشدار: config.json خوانده نشد، از پیش‌فرض استفاده می‌شود.');
}

// users.json
const USERS_PATH = path.join(__dirname, 'users.json');
let usersDB = {};
try {
  if (fs.existsSync(USERS_PATH)) {
    usersDB = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8') || '{}');
  } else {
    fs.writeFileSync(USERS_PATH, JSON.stringify({}, null, 2));
  }
} catch (e) {
  console.error('خطا در users.json:', e);
  process.exit(1);
}
function saveUsers() {
  fs.writeFileSync(USERS_PATH, JSON.stringify(usersDB, null, 2));
}

// وضعیت‌ها
const adminState = {};
const userState = {};

// راه‌اندازی بات
const bot = new Telegraf(BOT_TOKEN);

function isAdmin(id) {
  return config.adminIds.includes(Number(id));
}
function ensureUser(ctx) {
  const uid = String(ctx.from.id);
  if (!usersDB[uid]) {
    usersDB[uid] = {
      id: ctx.from.id,
      username: ctx.from.username || '',
      full_name: '',
      contact_phone: '',
      agreementAccepted: false,
      inviteLinkIssued: false,
      inviteLink: ''
    };
    saveUsers();
  }
  return usersDB[uid];
}

// کیبوردها
function contactKeyboard() {
  return Markup.keyboard([Markup.button.contactRequest('ارسال شماره تماس 📱')]).resize().oneTime();
}
function agreementKeyboard() {
  return Markup.inlineKeyboard([Markup.button.callback('تایید میکنم ✅', 'AGREE_CONFIRM')]);
}
function startKeyboard() {
  const vipUsername = (config.vipChannelUsername || '').replace('@', '');
  const buttons = [Markup.button.callback('شروع ثبت‌نام ✍️', 'START_REG')];
  if (vipUsername) buttons.push(Markup.button.url('کانال عمومی', `https://t.me/${vipUsername}`));
  return Markup.inlineKeyboard(buttons);
}
function adminMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('تغییر پیام خوش‌آمد 📝', 'ADMIN_CHANGE_WELCOME')],
    [Markup.button.callback('تغییر متن توافقنامه 📜', 'ADMIN_CHANGE_AGREEMENT')],
    [Markup.button.callback('تغییر لینک VIP 🔗', 'ADMIN_CHANGE_VIP')],
    [Markup.button.callback('مشاهده کاربران 👥', 'ADMIN_LIST_USERS')]
  ]);
}

// لینک VIP
async function createInvite(ctx) {
  const chatId = config.vipChannelId || config.vipChannelUsername;
  try {
    const res = await ctx.telegram.createChatInviteLink(chatId, { member_limit: 1 });
    return res.invite_link;
  } catch {
    return config.fallbackVipLink || '';
  }
}

// شروع
bot.start(async (ctx) => {
  ensureUser(ctx);
  userState[ctx.from.id] = null;
  await ctx.reply(config.welcomeMessage, startKeyboard());
});

// ثبت‌نام
bot.action('START_REG', async (ctx) => {
  ensureUser(ctx);
  await ctx.answerCbQuery();
  await ctx.reply('لطفاً نام و نام خانوادگی خود را وارد کنید:');
  userState[ctx.from.id] = 'awaitFullName';
});

// دریافت نام
bot.on('text', async (ctx, next) => {
  const state = userState[ctx.from.id];
  if (state === 'awaitFullName') {
    const full = ctx.message.text.trim();
    if (full.length < 3) return ctx.reply('نام معتبر نیست.');
    const u = ensureUser(ctx);
    u.full_name = full;
    saveUsers();
    await ctx.reply('شماره خود را ارسال کنید:', contactKeyboard());
    userState[ctx.from.id] = 'awaitContact';
    return;
  }
  // تغییرات ادمین
  const st = adminState[ctx.from.id]?.mode;
  if (st === 'changeWelcome' && isAdmin(ctx.from.id)) {
    config.welcomeMessage = ctx.message.text;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    adminState[ctx.from.id] = null;
    return ctx.reply('پیام خوش‌آمد تغییر کرد ✅');
  }
  if (st === 'changeAgreement' && isAdmin(ctx.from.id)) {
    config.agreementText = ctx.message.text;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    adminState[ctx.from.id] = null;
    return ctx.reply('توافقنامه تغییر کرد ✅');
  }
  if (st === 'changeVipLink' && isAdmin(ctx.from.id)) {
    config.fallbackVipLink = ctx.message.text.trim();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    adminState[ctx.from.id] = null;
    return ctx.reply('لینک VIP تغییر کرد ✅');
  }
  return next();
});

// دریافت شماره
bot.on('contact', async (ctx) => {
  if (userState[ctx.from.id] !== 'awaitContact') return;
  const u = ensureUser(ctx);
  u.contact_phone = ctx.message.contact.phone_number;
  saveUsers();
  await ctx.reply(config.agreementText, agreementKeyboard());
  userState[ctx.from.id] = 'awaitAgreement';
});

// تایید توافقنامه
bot.action('AGREE_CONFIRM', async (ctx) => {
  const u = ensureUser(ctx);
  await ctx.answerCbQuery();
  u.agreementAccepted = true;
  saveUsers();
  if (!u.inviteLinkIssued) {
    const link = await createInvite(ctx);
    u.inviteLink = link;
    u.inviteLinkIssued = true;
    saveUsers();
    await ctx.reply(`لینک VIP شما:\n${link}`);
  } else {
    await ctx.reply(`لینک قبلاً صادر شده:\n${u.inviteLink}`);
  }
  await ctx.reply('خوش آمدی 🎉');
  userState[ctx.from.id] = null;
});

// داشبورد ادمین
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('دسترسی ندارید.');
  await ctx.reply('داشبورد مدیریت:', adminMenuKeyboard());
});
bot.action('ADMIN_CHANGE_WELCOME', async (ctx) => { if (isAdmin(ctx.from.id)) { adminState[ctx.from.id] = { mode: 'changeWelcome' }; await ctx.reply('متن جدید خوش‌آمد را ارسال کنید:'); }});
bot.action('ADMIN_CHANGE_AGREEMENT', async (ctx) => { if (isAdmin(ctx.from.id)) { adminState[ctx.from.id] = { mode: 'changeAgreement' }; await ctx.reply('متن جدید توافقنامه را ارسال کنید:'); }});
bot.action('ADMIN_CHANGE_VIP', async (ctx) => { if (isAdmin(ctx.from.id)) { adminState[ctx.from.id] = { mode: 'changeVipLink' }; await ctx.reply('لینک VIP جدید را ارسال کنید:'); }});
bot.action('ADMIN_LIST_USERS', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const lines = Object.values(usersDB).map(u => `ID:${u.id} | نام:${u.full_name} | شماره:${u.contact_phone} | تایید:${u.agreementAccepted?'✅':'❌'} |
