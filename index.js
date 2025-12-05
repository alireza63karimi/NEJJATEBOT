// index.js - Final Production Ready Version for Render

const fs = require('fs');
const express = require('express');
const { Telegraf } = require('telegraf');

// ---------------------------
// Load config
// ---------------------------
const config = JSON.parse(fs.readFileSync('config.json'));

// Read bot token from secret file on Render
const BOT_TOKEN = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf8').trim();

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const PORT = process.env.PORT || 3000;

// ---------------------------
// Load users
// ---------------------------
let users = [];
const USERS_FILE = 'users.json';
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function isAdmin(userId) {
    return config.adminIds.includes(userId);
}

// ---------------------------
// START command
// ---------------------------
bot.start(async (ctx) => {
    const userId = ctx.from.id;

    let user = users.find(u => u.id === userId);
    if (!user) {
        user = {
            id: userId,
            first_name: ctx.from.first_name || "",
            last_name: ctx.from.last_name || "",
            username: ctx.from.username || "",
            phone: null,
            joinDate: new Date().toISOString(),
            vipSent: false
        };
        users.push(user);
        saveUsers();
    }

    await ctx.reply(config.welcomeMessage, {
        reply_markup: {
            keyboard: [
                [{ text: "ارسال شماره", request_contact: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

// ---------------------------
// CONTACT handler
// ---------------------------
bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    const userId = ctx.from.id;

    let user = users.find(u => u.id === userId);
    if (!user) return;

    user.phone = contact.phone_number;
    saveUsers();

    await ctx.reply(config.agreementText, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "تایید میکنم ✅", callback_data: "agree" }]
            ]
        }
    });
});

// ---------------------------
// AGREEMENT handler
// ---------------------------
bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);

    if (!user) return ctx.answerCbQuery("خطا!");

    if (ctx.callbackQuery.data === 'agree') {

        if (!user.vipSent) {
            let linkToSend = config.vipChannelLink;

            // Auto one-time generated invite link
            if (config.autoInviteMode === true && config.vipChannelUsername) {
                try {
                    const invite = await bot.telegram.createChatInviteLink(`@${config.vipChannelUsername}`, {
                        expire_date: Math.floor(Date.now() / 1000) + 600,
                        member_limit: 1
                    });
                    linkToSend = invite.invite_link;
                } catch (e) {
                    console.error("Error generating invite link:", e);
                }
            }

            await ctx.reply("لینک VIP شما:\n" + linkToSend);
            user.vipSent = true;
            saveUsers();
        } else {
            await ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید.");
        }
    }

    await ctx.answerCbQuery();
});

// ---------------------------
// ADMIN COMMANDS
// ---------------------------
bot.command('users', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    let msg = users.map(u => `${u.first_name} ${u.last_name} | @${u.username} | ${u.phone || 'بدون شماره'} | ${u.joinDate}`).join("\n");
    await ctx.reply(msg || "کاربری ثبت نشده است.");
});

bot.command('setwelcome', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const newMsg = ctx.message.text.replace('/setwelcome', '').trim();
    if (!newMsg) return ctx.reply("متن جدید را بعد از دستور بنویسید.");

    config.welcomeMessage = newMsg;
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));

    ctx.reply("پیام خوش‌آمد با موفقیت تغییر کرد.");
});

bot.command('setagree', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const newMsg = ctx.message.text.replace('/setagree', '').trim();
    if (!newMsg) return ctx.reply("متن جدید را بعد از دستور بنویسید.");

    config.agreementText = newMsg;
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));

    ctx.reply("متن توافقنامه تغییر کرد.");
});

bot.command('setvip', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const newLink = ctx.message.text.replace('/setvip', '').trim();
    if (!newLink) return ctx.reply("لینک جدید را بعد از دستور بنویسید.");

    config.vipChannelLink = newLink;
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));

    ctx.reply("لینک VIP با موفقیت تغییر کرد.");
});

// ---------------------------
// WEBHOOK
// ---------------------------
app.use(bot.webhookCallback('/bot'));

app.get('/', (req, res) => res.send('NEJJATEBOT is running successfully.'));

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    const url = process.env.WEBHOOK_URL;
    if (!url) {
        console.error("WEBHOOK_URL not set!");
        return;
    }

    await bot.telegram.setWebhook(`${url}/bot`);
    console.log("Webhook connected successfully.");
});
