const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Load bot token from secret file
const token = fs.readFileSync('/etc/secrets/bot_token.txt', 'utf8').trim();
console.log('BOT TOKEN LOADED FROM SECRET FILE.');

const bot = new TelegramBot(token, { polling: true });

// Express server for Render port binding
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Users file
const usersFile = './users.json';
let users = [];
if (fs.existsSync(usersFile)) {
    const data = fs.readFileSync(usersFile, 'utf8');
    try { users = JSON.parse(data); } 
    catch { users = []; }
} else {
    fs.writeFileSync(usersFile, '[]');
}

// Admins
const admins = [6043389836, 188225902];

// Default messages (can be edited by admin)
let welcomeMessage = 'هم فرکانسی عزیز خوش آمدی! برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید.';
let agreementText = 'من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم';
let vipLink = 'https://t.me/+VIPChannelLinkHere';

// Helper: save users
function saveUsers
