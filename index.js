// index.js
// NEJJATEBOT - نسخه نهایی آماده دیپلوی روی Render یا هر Node.js 18+
// نیازمندی‌ها:
//   npm install telegraf express
//
// اصلاحات کلیدی:
// - مقداردهی امن config و کلیدهای ضروری
// - هندل خطای 409 (Webhook vs Polling)
// - راه‌اندازی خودکار Webhook اگر WEBHOOK_DOMAIN تنظیم شود
// - پاک کردن Webhook و استفاده از Polling در غیر این صورت
// - جلوگیری از کرش در startKeyboard وقتی vipChannelUsername خالی است

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN_PATH = path.join(__dirname, 'bot_token.txt');
let BOT_TOKEN = '';
try {
  BOT_TOKEN = fs.readFileSync(BOT_TOKEN_PATH, 'utf8').trim();
} catch (e) {
  console.error('فایل bot_token.txt یافت/خوانده نشد. لطفاً در Render به عنوان Secret File بسازید.');
  process.exit(1);
}
if (!BOT_TOKEN) {
  console.error('توکن ربات خالی است. bot_token.txt را بررسی کنید.');
  process.exit(1);
}

// خواندن config با مقداردهی پیش‌فرض امن
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
  const parsed = JSON.parse(raw);
  // ادغام امن
  config = {
    ...config,
    ...parsed
  };
} catch (e) {
  console.warn('هشدار: config.json خوانده نشد یا نامعتبر است. از تنظیمات پیش‌فرض استفاده می‌شود.');
}

// تضمین رشته‌های ضروری
if (typeof config.vipChannelUsername !== 'string' || !config.vipChannelUsername.trim()) {
  config.vipChannelUsername = '@NEJJATE_VIP';
}
if (typeof config.botUsername !== 'string' || !config.botUsername.trim()) {
  config.botUsername = '@NEJJATEBOT';
}

// مسیر و دیتابیس کاربران
const USERS_PATH = path.join(__dirname, 'users.json');
let usersDB = {};
try {
  if (fs.existsSync(USERS_PATH)) {
    const content = fs.readFileSync(USERS_PATH, 'utf8');
    usersDB = content ? JSON.parse(content) : {};
  } else {
    fs.writeFileSync(USERS_PATH, JSON.stringify({}, null, 2), 'utf8');
    usersDB = {};
  }
} catch (e) {
  console.error('خطا در خواندن/نوشتن users.json:', e);
  process.exit(1);
}
function saveUsers() {
  try {
    fs.writeFileSync(USERS_PATH, JSON.stringify(usersDB, null, 2), 'utf8');
  } catch (e) {
    console.error('خطا در ذخیره users.json:', e);
  }
}

// وضعیت‌ها
const adminState = {}; // { adminId: { mode: 'changeWelcome'|'changeAgreement'|'changeVipLink' } }
const userState = {};  // { userId: 'awaitFullName'|'awaitContact'|'awaitAgreement' }

// راه‌اندازی بات
const bot = new Telegraf(BOT_TOKEN);

// کمک‌تابع‌ها
function isAdmin(userId) {
  return Array.isArray(config.adminIds) && config.adminIds.map(Number).includes(Number(userId));
}
function ensureUserRecord(ctx) {
  const uid = String(ctx.from.id);
  if (!usersDB[uid]) {
    usersDB[uid] = {
      id: ctx.from.id,
      first_name: ctx.from.first_name || '',
      last_name: ctx.from.last_name || '',
      username: ctx.from.username || '',
      full_name: '',
      contact_phone: '',
      agreementAccepted: false,
      inviteLinkIssued: false,
      inviteLink: '',
      registeredAt: new Date().toISOString()
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
  if (vipUsername) {
    buttons.push(Markup.button.url('کانال عمومی', `https://t.me/${vipUsername}`));
  }
  return Markup.inlineKeyboard(buttons);
}
function adminMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('تغییر پیام خوش‌آمد 📝', 'ADMIN_CHANGE_WELCOME')],
    [Markup.button.callback('تغییر متن توافقنامه 📜', 'ADMIN_CHANGE_AGREEMENT')],
    [Markup.button.callback('تغییر لینک VIP 🔗', 'ADMIN_CHANGE_VIP')],
    [Markup.button.callback('مشاهده کاربران ثبت‌نام‌شده 👥', 'ADMIN_LIST_USERS')]
  ]);
}

// تولید لینک یک‌بارمصرف VIP
async function createSingleUseInvite(ctx) {
  const chatId = config.vipChannelId || config.vipChannelUsername;
  try {
    const res = await ctx.telegram.createChatInviteLink(chatId, {
      name: `Invite_${ctx.from.id}_${Date.now()}`,
      member_limit: 1,
      creates_join_request: false
    });
    return res.invite_link;
  } catch (e) {
    console.error('خطا در ایجاد لینک یک‌بارمصرف VIP:', e);
    return config.fallbackVipLink || '';
  }
}

// شروع
bot.start(async (ctx) => {
  ensureUserRecord(ctx);
  userState[ctx.from.id] = null;
  await ctx.reply(config.welcomeMessage, startKeyboard());
});

// ثبت‌نام
bot.action('START_REG', async (ctx) => {
  ensureUserRecord(ctx);
  await ctx.answerCbQuery();
  await ctx.reply('لطفاً نام و نام خانوادگی خود را وارد کنید (مثال: علی رضایی):');
  userState[ctx.from.id] = 'awaitFullName';
});

// دریافت نام کامل و هندل تغییرات ادمین
bot.on('text', async (ctx, next) => {
  const state = userState[ctx.from.id];

  if (state === 'awaitFullName') {
    const full = (ctx.message.text || '').trim();
    if (full.length < 3) {
      await ctx.reply('نام واردشده معتبر نیست. لطفاً نام و نام خانوادگی را دقیق وارد کنید.');
      return;
    }
    const u = ensureUserRecord(ctx);
    u.full_name = full;
    saveUsers();

    await ctx.reply('حالا لطفاً شماره تلگرام خود را با دکمه زیر ارسال کنید:', contactKeyboard());
    userState[ctx.from.id] = 'awaitContact';
    return;
  }

  // تغییرات ادمین
  const st = adminState[ctx.from.id]?.mode;
  if (st === 'changeWelcome' && isAdmin(ctx.from.id)) {
    config.welcomeMessage = ctx.message.text;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    adminState[ctx.from.id] = null;
    await ctx.reply('پیام خوش‌آمد با موفقیت تغییر کرد ✅');
    return;
  }
  if (st === 'changeAgreement' && isAdmin(ctx.from.id)) {
    config.agreementText = ctx.message.text;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    adminState[ctx.from.id] = null;
    await ctx.reply('متن توافقنامه با موفقیت تغییر کرد ✅');
    return;
  }
  if (st === 'changeVipLink' && isAdmin(ctx.from.id)) {
    config.fallbackVipLink = ctx.message.text.trim();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    adminState[ctx.from.id] = null;
    await ctx.reply('لینک VIP پشتیبان با موفقیت تغییر کرد ✅');
    return;
  }

  return next();
});

// دریافت شماره از Contact
bot.on('contact', async (ctx) => {
  if (userState[ctx.from.id] !== 'awaitContact') return;
  const contact = ctx.message.contact;
  if (!contact || !contact.phone_number) {
    await ctx.reply('شماره معتبر دریافت نشد. لطفاً دوباره با دکمه ارسال شماره، شماره خود را ارسال کنید.');
    return;
  }
  const u = ensureUserRecord(ctx);
  u.contact_phone = contact.phone_number;
  saveUsers();

  await ctx.reply(config.agreementText, agreementKeyboard());
  userState[ctx.from.id] = 'awaitAgreement';
});

// تایید توافقنامه و ارسال لینک یک‌بارمصرف
bot.action('AGREE_CONFIRM', async (ctx) => {
  const u = ensureUserRecord(ctx);
  await ctx.answerCbQuery();
  if (userState[ctx.from.id] !== 'awaitAgreement') {
    await ctx.reply('برای ادامه، لطفاً از مسیر ثبت‌نام اقدام کنید: /start');
    return;
  }
  u.agreementAccepted = true;
  saveUsers();

  if (u.inviteLinkIssued && u.inviteLink) {
    await ctx.reply(`لینک عضویت شما قبلاً صادر شده است:\n${u.inviteLink}`);
  } else {
    const link = await createSingleUseInvite(ctx);
    if (!link) {
      await ctx.reply('ایجاد لینک VIP ممکن نشد. مطمئن شوید بات ادمین کانال است یا لینک پشتیبان در داشبورد تنظیم شود.');
    } else {
      u.inviteLink = link;
      u.inviteLinkIssued = true;
      saveUsers();
      await ctx.reply(`لینک VIP شما (یک‌بارمصرف):\n${link}\n\nتوجه: این لینک فقط برای یک‌بار قابل استفاده است.`);
    }
  }

  await ctx.reply('خوش آمدی! عضویت VIP تو آماده شد 🎉');
  userState[ctx.from.id] = null;
});

// داشبورد ادمین
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('دسترسی شما مجاز نیست.');
    return;
  }
  await ctx.reply('داشبورد مدیریت:', adminMenuKeyboard());
});
bot.action('ADMIN_CHANGE_WELCOME', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('اجازه دسترسی ندارید.');
  await ctx.answerCbQuery();
  adminState[ctx.from.id] = { mode: 'changeWelcome' };
  await ctx.reply('متن جدید پیام خوش‌آمد را ارسال کنید:');
});
bot.action('ADMIN_CHANGE_AGREEMENT', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('اجازه دسترسی ندارید.');
  await ctx.answerCbQuery();
  adminState[ctx.from.id] = { mode: 'changeAgreement' };
  await ctx.reply('متن جدید توافقنامه را ارسال کنید:');
});
bot.action('ADMIN_CHANGE_VIP', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('اجازه دسترسی ندارید.');
  await ctx.answerCbQuery();
  adminState[ctx.from.id] = { mode: 'changeVipLink' };
  await ctx.reply('لینک VIP پشتیبان را ارسال کنید (برای مواقعی که ساخت لینک یک‌بارمصرف ممکن نیست):');
});
bot.action('ADMIN_LIST_USERS', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('اجازه دسترسی ندارید.');
  await ctx.answerCbQuery();
  const allUsers = Object.values(usersDB);
  if (allUsers.length === 0) return ctx.reply('هیچ کاربری ثبت نشده است.');
  const lines = allUsers.map(u => {
    const uname = u.username ? `@${u.username}` : '(بدون یوزرنیم)';
    const name = u.full_name || `${u.first_name} ${u.last_name || ''}`.trim();
    return `ID: ${u.id} | ${uname} | نام: ${name} | شماره: ${u.contact_phone || '-'} | تایید: ${u.agreementAccepted ? '✅' : '❌'} | لینک صادر شد: ${u.inviteLinkIssued ? '✅' : '❌'}`;
  });
  const chunkSize = 25;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize).join('\n');
    await ctx.reply(chunk);
  }
});

// هندل خطاها
bot.catch((err, ctx) => {
  console.error('خطا در بات:', err);
  try { ctx.reply('یک خطای غیرمنتظره رخ داد. لطفاً دوباره تلاش کنید.'); } catch (_) {}
});

// راه‌اندازی سرویس سلامت و وبهوک/پولینگ
const app = express();
app.get('/', (req, res) => res.send('NEJJATEBOT is running.'));

// اگر WEBHOOK_DOMAIN تنظیم شده باشد، از وبهوک استفاده می‌کنیم؛ در غیر این صورت، وبهوک را پاک و پولینگ می‌کنیم
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || process.env.RENDER_EXTERNAL_URL || ''; // اگر URL خارجی Render را داری
const WEBHOOK_PATH = `/telegraf/${BOT_TOKEN}`; // مسیر امن مبتنی بر توکن

async function launchBot() {
  try {
    if (WEBHOOK_DOMAIN) {
      // وبهوک
      const fullUrl = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;
      await bot.telegram.setWebhook(fullUrl);
      app.use(WEBHOOK_PATH, bot.webhookCallback(fullUrl));
      app.listen(PORT, () => console.log(`Webhook server on ${PORT}, URL: ${fullUrl}`));
      console.log('Bot launched in WEBHOOK mode.');
    } else {
      // پاک کردن وبهوک و پولینگ
      await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
      await bot.launch();
      app.listen(PORT, () => console.log(`Health server on port ${PORT}`));
      console.log('Bot launched in POLLING mode.');
    }
  } catch (e) {
    console.error('Failed to launch bot:', e);
    // تلاش جایگزین: پاک کردن وبهوک و استفاده از پولینگ
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch();
      app.listen(PORT, () => console.log(`Health server on port ${PORT}`));
      console.log('Bot launched in POLLING fallback.');
    } catch (err) {
      console.error('Fallback launch also failed:', err);
      process.exit(1);
    }
  }
}

launchBot();

// شات‌داون امن
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
