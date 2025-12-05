const fs = require('fs');
const express = require('express');
const { Telegraf } = require('telegraf');

// Load config
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const BOT_TOKEN = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf8').trim();

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const PORT = process.env.PORT || 3000;

// Load users
let users = [];
const USERS_FILE = 'users.json';
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

// Save users
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Check admin
function isAdmin(id) {
    return config.adminIds.includes(id);
}

// Create one-time invite link
async function generateInviteLink(ctx) {
    try {
        const link = await ctx.telegram.exportChatInviteLink(config.vipChannelId);
        return link;
    } catch (err) {
        console.error("Invite link error:", err.message);
        return null;
    }
}

// Start
bot.start(async (ctx) => {
    const userId = ctx.from.id;

    let user = users.find(u => u.id === userId);
    if (!user) {
        user = {
            id: userId,
            first_name: ctx.from.first_name || "",
            last_name: ctx.from.last_name || "",
            username: ctx.from.username || "",
            phone: "",
            vipSent: false,
            joinDate: new Date().toISOString()
        };
        users.push(user);
        saveUsers();
    }

    await ctx.reply(config.welcomeMessage, {
        reply_markup: {
            keyboard: [
                [{ text: "ارسال شماره 📱", request_contact: true }]
            ],
            resize_keyboard: true
        }
    });
});

// Contact
bot.on("contact", async (ctx) => {
    const userId = ctx.from.id;
    const contact = ctx.message.contact;

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

// Agreement → Send VIP link
bot.on("callback_query", async (ctx) => {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;

    let user = users.find(u => u.id === userId);
    if (!user) return ctx.answerCbQuery("خطا!");

    if (data === "agree") {
        if (user.vipSent) {
            await ctx.reply("شما قبلاً لینک VIP را دریافت کرده‌اید.");
        } else {
            const inviteLink = await generateInviteLink(ctx);

            if (!inviteLink) {
                await ctx.reply("خطا در ساخت لینک VIP. لطفاً ربات را مدیر کانال کن 👇\n\nدسترسی لازم:\n➤ Add members");
            } else {
                await ctx.reply(`لینک VIP شما 👇\n${inviteLink}`);
                user.vipSent = true;
                saveUsers();
            }
        }
    }

    await ctx.answerCbQuery();
});

// ADMIN: show users
bot.command("users", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    if (users.length === 0) return ctx.reply("هیچ کاربری وجود ندارد.");

    let list = users
        .map(u => `👤 ${u.first_name} ${u.last_name} | @${u.username}\n📱 ${u.phone}\n📅 ${u.joinDate}\n—————`)
        .join("\n");

    await ctx.reply(list);
});

// Webhook
app.use(bot.webhookCallback('/bot'));
app.get('/', (req, res) => res.send("Bot is running!"));

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const url = process.env.WEBHOOK_URL || "https://YOUR_RENDER_URL.onrender.com";
    await bot.telegram.setWebhook(`${url}/bot`);
});
