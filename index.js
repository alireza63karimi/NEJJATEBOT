const fs = require('fs');
const { Telegraf } = require('telegraf');
const path = require('path');

// Load bot token from Render Secret File
const token = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf-8').trim();
const bot = new Telegraf(token);

// Admin IDs
const ADMINS = [6043389836, 188225902];

// File to store user data
const USERS_FILE = path.join(__dirname, 'users.json');
let users = [];

// Load users from file
if (fs.existsSync(USERS_FILE)) {
  const data = fs.readFileSync(USERS_FILE);
  try {
    users = JSON.parse(data);
  } catch {
    users = [];
  }
}

// Default texts
let WELCOME_TEXT = "هم فرکانسی عزیز خوش آمدی! برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید.";
let AGREEMENT_TEXT = "من به خودم قول شرف میدهم تمارین این دوره را انجام دهم و خودم را تغییر دهم.";
let VIP_LINK = "https://t.me/YourVIPChannel";

// Save users to file
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  let user = users.find(u => u.id === userId);

  if (!user) {
    await ctx.reply(WELCOME_TEXT);
    await ctx.reply(AGREEMENT_TEXT, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "تایید میکنم ✅", callback_data: "agree" }]
        ]
      }
    });
  } else {
    await ctx.reply("شما قبلاً ثبت نام کرده‌اید.");
    await sendVIPLink(ctx, user);
  }
});

// Agreement button
bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  if (ctx.callbackQuery.data === 'agree') {
    let user = users.find(u => u.id === userId);
    if (!user) {
      // Ask for full name
      await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
      bot.on('text', async (msgCtx) => {
        if (msgCtx.from.id === userId) {
          const fullName = msgCtx.message.text;
          // Ask for contact
          await msgCtx.reply("لطفاً روی دکمه زیر بزنید تا شماره تلگرام شما ارسال شود:", {
            reply_markup: {
              keyboard: [
                [{ text: "ارسال شماره", request_contact: true }]
              ],
              resize_keyboard: true,
              one_time_keyboard: true
            }
          });

          bot.on('contact', async (contactCtx) => {
            if (contactCtx.from.id === userId) {
              const phoneNumber = contactCtx.message.contact.phone_number;
              const date = new Date().toISOString();
              const newUser = {
                id: userId,
                fullName,
                phoneNumber,
                joinedAt: date
              };
              users.push(newUser);
              saveUsers();

              await contactCtx.reply("ثبت نام شما با موفقیت انجام شد!");
              await sendVIPLink(contactCtx, newUser);
            }
          });
        }
      });
    }
  }
});

// Send VIP link once
async function sendVIPLink(ctx, user) {
  if (user.linkSent) {
    await ctx.reply("شما قبلاً لینک را دریافت کرده‌اید.");
  } else {
    await ctx.reply(`لینک کانال VIP شما: ${VIP_LINK}`);
    user.linkSent = true;
    saveUsers();
  }
}

// Admin commands
bot.command('admin', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  ctx.reply("دستورات ادمین:\n/setwelcome - تغییر متن خوش آمدگویی\n/setagreement - تغییر متن توافقنامه\n/setlink - تغییر لینک کانال VIP\n/listusers - مشاهده کاربران ثبت نام شده");
});

// Change welcome text
bot.command('setwelcome', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  const newText = ctx.message.text.replace('/setwelcome ', '');
  WELCOME_TEXT = newText;
  ctx.reply("متن خوش آمدگویی تغییر یافت.");
});

// Change agreement text
bot.command('setagreement', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  const newText = ctx.message.text.replace('/setagreement ', '');
  AGREEMENT_TEXT = newText;
  ctx.reply("متن توافقنامه تغییر یافت.");
});

// Change VIP link
bot.command('setlink', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  const newLink = ctx.message.text.replace('/setlink ', '');
  VIP_LINK = newLink;
  ctx.reply("لینک کانال VIP تغییر یافت.");
});

// List users
bot.command('listusers', (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  let list = users.map(u => `${u.fullName} | ${u.phoneNumber} | ${u.joinedAt}`).join('\n');
  ctx.reply(list || "هیچ کاربری ثبت نشده است.");
});

// Launch bot
bot.launch().then(() => console.log("BOT STARTED 🚀"));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
