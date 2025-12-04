const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

// Load bot token from Secret File on Render
const token = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf8').trim();
console.log("BOT TOKEN LOADED FROM SECRET FILE.");

const bot = new TelegramBot(token, { polling: true });

// Load config
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Load users
let users = [];
if (fs.existsSync('users.json')) {
  const data = fs.readFileSync('users.json', 'utf8');
  users = data ? JSON.parse(data) : [];
}

// Helper to save users
function saveUsers() {
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
}

// Start command
bot.onText(/\/start/i, (msg) => {
  const chatId = msg.chat.id;
  const user = users.find(u => u.id === chatId);
  if (user) {
    bot.sendMessage(chatId, "شما قبلاً ثبت نام کرده‌اید.");
    return;
  }

  bot.sendMessage(chatId, config.welcomeMessage, {
    reply_markup: {
      keyboard: [[{ text: "ارسال شماره", request_contact: true }]],
      one_time_keyboard: true
    }
  });
});

// Handle contact info
bot.on('contact', (msg) => {
  const chatId = msg.chat.id;
  const contact = msg.contact;
  if (users.find(u => u.id === chatId)) {
    bot.sendMessage(chatId, "شما قبلاً ثبت نام کرده‌اید.");
    return;
  }

  users.push({
    id: chatId,
    first_name: contact.first_name,
    last_name: contact.last_name || '',
    phone_number: contact.phone_number
  });
  saveUsers();

  // Send agreement
  bot.sendMessage(chatId, config.agreementText, {
    reply_markup: {
      keyboard: [[{ text: "تایید میکنم" }]],
      one_time_keyboard: true
    }
  });
});

// Handle agreement confirmation
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (msg.text === "تایید میکنم") {
    const user = users.find(u => u.id === chatId);
    if (!user.linkSent) {
      bot.sendMessage(chatId, `لینک کانال VIP شما: ${config.vipLink}`);
      user.linkSent = true;
      saveUsers();
    } else {
      bot.sendMessage(chatId, "شما قبلاً لینک را دریافت کرده‌اید.");
    }
  }
});

// Admin commands
bot.onText(/\/admin/i, (msg) => {
  const chatId = msg.chat.id;
  if (!config.admins.includes(chatId)) return;

  bot.sendMessage(chatId, "دستورات مدیریت:\n1. تغییر پیام خوش‌آمد\n2. تغییر متن توافقنامه\n3. تغییر لینک VIP\n4. مشاهده کاربران");
});

// Other admin functionalities can be implemented similarly
