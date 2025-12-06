import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// -----------------------------
// خواندن توکن از Secret File
// -----------------------------
const TOKEN_PATH = path.resolve("/etc/secrets/bot_token.txt"); // مسیر Secret File در Render
if (!fs.existsSync(TOKEN_PATH)) {
  console.error("❌ فایل bot_token.txt موجود نیست یا مسیر اشتباه است!");
  process.exit(1);
}
const TOKEN = fs.readFileSync(TOKEN_PATH, "utf8").trim();

// -----------------------------
// Webhook URL و Port
// -----------------------------
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!WEBHOOK_URL) {
  console.error("❌ WEBHOOK_URL تنظیم نشده است!");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const app = express();
app.use(express.json());

// -----------------------------
// فایل‌ها
// -----------------------------
const CONFIG_FILE = path.resolve("./config.json");
const USERS_FILE = path.resolve("./users.json");

let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE))
  : {
      welcomeMessage:
        "هم فرکانسی عزیز خوش آمدی! برای دریافت لینک کانال VIP باید اطلاعات خواسته شده را ارسال کنید.",
      agreementText:
        "من به خودم قول شرف می‌دهم تمارین این دوره را انجام دهم و خودم را تغییر دهم",
      agreementButton: "تایید میکنم ✅",
      vipPrivateLink: "https://t.me/YourVIPChannel",
      admins: [],
    };

let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : {};

// -----------------------------
// توابع کمک‌کننده
// -----------------------------
function saveConfig() {
  fs.write
