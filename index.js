const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const express = require("express");
const config = require("./config.json");

// ⛑ خواندن توکن از Secret File
let token;
try {
    token = fs.readFileSync("/etc/secrets/bot_token.txt", "utf8").trim();
} catch (err) {
    console.error("خطا: توکن ربات پیدا نشد. Secret File درست ساخته شده؟");
    process.exit(1);
}

const bot = new Telegraf(token);
const USERS_FILE = "users.json";

// ========================
// بارگذاری و ذخیره کاربران
// ========================
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, "utf8");
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch (e) {
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ========================
// Web Server کوچک برای Render Free
// ========================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("ربات فعال است 🚀");
});

app.get("/healthz", (req, res) => {
    res.send("OK");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// ========================
// ربات تلگرام
// ========================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    let users = loadUsers();

    const exists = users.find((u) => u.id === userId);
    if (exists) {
        return ctx.reply("شما قبلاً ثبت‌نام کرده‌اید ✅");
    }

    await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
    users.push({ id: userId, step: "name" });
    saveUsers(users);
});

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    let users = loadUsers();
    let user = users.find((u) => u.id === userId);
    if (!user) return;

    if (user.step === "name") {
        user.name = ctx.message.text;
        user.step = "phone";
        saveUsers(users);

        return ctx.reply(
            "لطفاً روی دکمه زیر بزنید تا شماره تلگرام شما ارسال شود:",
            Markup.keyboard([Markup.button.contactRequest("📞 ارسال شماره")]).resize()
        );
    }
});

bot.on("contact", async (ctx) => {
    const userId = ctx.from.id;
    let users = loadUsers();
    let user = users.find((u) => u.id === userId);
    if (!user) return;

    user.phone = ctx.message.contact.phone_number;
    user.step = "agreement";
    saveUsers(users);

    await ctx.reply("متن توافقنامه:");
    await ctx.reply(config.AGREEMENT_TEXT, Markup.inlineKeyboard([
        Markup.button.callback("✔ تایید میکنم", "accept")
    ]));
});

bot.action("accept", async (ctx) => {
    const userId = ctx.from.id;
    let users = loadUsers();
    let user = users.find((u) => u.id === userId);
    if (!user) return;

    user.accepted = true;
    user.step = "done";
    saveUsers(users);

    await ctx.reply("💎 شما با موفقیت عضو شدید!");
    await ctx.reply("لینک ورود VIP:", {
        reply_markup: { inline_keyboard: [[{ text: "ورود به VIP", url: config.VIP_LINK }]] }
    });
});

// دستور ادمین برای مشاهده کاربران
bot.command("users", (ctx) => {
    if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

    const users = loadUsers();
    let text = "📋 لیست کاربران ثبت‌شده:\n\n";
    users.forEach((u) => {
        text += `👤 ${u.name} — ${u.phone}\n`;
    });
    ctx.reply(text || "کاربری ثبت نشده است.");
});

// اجرای ربات با catch error
bot.launch()
.then(() => console.log("ربات با موفقیت اجرا شد 🚀"))
.catch(err => console.error("خطا در اجرای ربات:", err));
