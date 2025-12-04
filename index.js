const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Load bot token from secret file (Render)
const TOKEN_PATH = '/etc/secrets/bot_token.txt';
const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();

// Create bot
const bot = new TelegramBot(token, { polling: true });

// Express server for Render port binding
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('NEJJATEBOT is running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Admin user IDs
const admins = [6043389836, 188225902];

// Files
const USERS_FILE = './users.json';
const DEFAULT_USERS = [];
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : DEFAULT_USERS;

// Configurable texts
let welcomeMessage = "هم فرکانسی عزیز خوش آمدی برای دریافت لینک کانال vip باید اطلاعات خواسته شده را ارسال کنید";
let agreementText = "من به خودم قول شرف میدهم تمارین این دوره را انجام دهم و خودم را تغییر دهم";
let vipLink = "https://t.me/YOUR_VIP_CHANNEL";

// Save users function
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Check if user is admin
function isAdmin(id) {
    return admins.includes(id);
}

// Helper: find user by id
function getUser(userId) {
    return users.find(u => u.id === userId);
}

// Bot commands
bot.onText(/\/start/i, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: {
            keyboard: [[{ text: "ارسال نام و شماره", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

// Receive contact
bot.on('contact', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (getUser(userId)) {
        bot.sendMessage(chatId, "شما قبلاً اطلاعات خود را ارسال کرده‌اید.");
        return;
    }

    const name = msg.from.first_name || "";
    const lastName = msg.from.last_name || "";
    const phone = msg.contact.phone_number || "";

    users.push({ id: userId, name, lastName, phone });
    saveUsers();

    // Send agreement
    bot.sendMessage(chatId, agreementText, {
        reply_markup: {
            inline_keyboard: [[{ text: "تایید میکنم", callback_data: "agree" }]]
        }
    });
});

// Handle agreement button
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    if (query.data === 'agree') {
        // Check again if user already got VIP link
        const user = getUser(userId);
        if (user && !user.linkSent) {
            bot.sendMessage(chatId, `لینک کانال VIP شما: ${vipLink}`);
            user.linkSent = true;
            saveUsers();
        } else {
            bot.sendMessage(chatId, "شما قبلاً لینک کانال را دریافت کرده‌اید.");
        }
    }
});

// Admin commands
bot.onText(/\/admin/i, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, "دسترسی ندارید.");
        return;
    }

    bot.sendMessage(chatId, "منوی ادمین:\n1. تغییر متن خوش‌آمد\n2. تغییر متن توافقنامه\n3. تغییر لینک VIP\n4. مشاهده کاربران", {
        reply_markup: {
            keyboard: [
                ["تغییر متن خوش‌آمد", "تغییر متن توافقنامه"],
                ["تغییر لینک VIP", "مشاهده کاربران"]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

// Admin actions
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) return;

    const text = msg.text;

    switch (text) {
        case "تغییر متن خوش‌آمد":
            bot.sendMessage(chatId, "لطفاً متن خوش‌آمد جدید را ارسال کنید:");
            bot.once('message', (reply) => {
                welcomeMessage = reply.text;
                bot.sendMessage(chatId, "متن خوش‌آمد به‌روز شد.");
            });
            break;
        case "تغییر متن توافقنامه":
            bot.sendMessage(chatId, "لطفاً متن توافقنامه جدید را ارسال کنید:");
            bot.once('message', (reply) => {
                agreementText = reply.text;
                bot.sendMessage(chatId, "متن توافقنامه به‌روز شد.");
            });
            break;
        case "تغییر لینک VIP":
            bot.sendMessage(chatId, "لطفاً لینک VIP جدید را ارسال کنید:");
            bot.once('message', (reply) => {
                vipLink = reply.text;
                bot.sendMessage(chatId, "لینک VIP به‌روز شد.");
            });
            break;
        case "مشاهده کاربران":
            if (users.length === 0) {
                bot.sendMessage(chatId, "هیچ کاربری ثبت نشده است.");
            } else {
                const list = users.map(u => `ID: ${u.id}\nنام: ${u.name} ${u.lastName}\nشماره: ${u.phone}\nدریافت لینک: ${u.linkSent ? "✅" : "❌"}`).join("\n\n");
                bot.sendMessage(chatId, list);
            }
            break;
    }
});
