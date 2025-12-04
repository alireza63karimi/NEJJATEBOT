const fs = require('fs');
const express = require('express');
const { Telegraf } = require('telegraf');

// Load config
const config = JSON.parse(fs.readFileSync('config.json'));
const BOT_TOKEN = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf8').trim();

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const PORT = process.env.PORT || 3000;

// Load users
let users = [];
const USERS_FILE = 'users.json';
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE));
}

// Helper to save users
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Check if user is admin
function isAdmin(userId) {
    return config.adminIds.includes(userId);
}

// Start command
bot.start(async (ctx) => {
    const userId = ctx.from.id;

    // If user exists, show welcome again
    let user = users.find(u => u.id === userId);
    if (!user) {
        user = {
            id: userId,
            first_name: ctx.from.first_name || "",
            last_name: ctx.from.last_name || "",
            username: ctx.from.username || "",
            phone: null,
            joinDate: new Date().toISOString()
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

// Handle contact (phone number)
bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    const userId = ctx.from.id;
    let user = users.find(u => u.id === userId);
    if (user) {
        user.phone = contact.phone_number;
        saveUsers();
        await ctx.reply(config.agreementText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "تایید میکنم", callback_data: "agree" }]
                ]
            }
        });
    }
});

// Handle agreement
bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);

    if (!user) return ctx.answerCbQuery("خطا!");

    if (ctx.callbackQuery.data === 'agree') {
        // Check if user already received VIP link
        if (!user.vipSent) {
            await ctx.reply(`لینک کانال VIP شما: ${config.vipChannelLink}`);
            user.vipSent = true;
            saveUsers();
        } else {
            await ctx.reply("شما قبلا لینک دریافت کرده‌اید.");
        }
    }
    await ctx.answerCbQuery();
});

// Admin dashboard
bot.command('users', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    let msg = users.map(u => `${u.first_name} ${u.last_name} - @${u.username} - ${u.phone || 'ندارد'} - ${u.joinDate}`).join("\n");
    await ctx.reply(msg || "هیچ کاربری ثبت نشده است.");
});

// Express webhook endpoint
app.use(bot.webhookCallback('/bot'));

app.get('/', (req, res) => res.send('Bot is running!'));

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const url = process.env.WEBHOOK_URL || 'https://nejjatebot.onrender.com';
    await bot.telegram.setWebhook(`${url}/bot`);
});
