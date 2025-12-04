const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const config = require("./config.json");

// ⛑ خواندن توکن از Secret File
const token = fs.readFileSync("/etc/secrets/bot_token.txt", "utf8").trim();
const bot = new Telegraf(token);

// مسیر ذخیره کاربران
const USERS_FILE = "users.json";

// اگر فایل نبود یا محتوا خراب بود → بسازیم
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, "utf8");
        const parsed = JSON.parse(data);
        // اگر فایل آرایه نیست، آرایه بساز
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch (e) {
        return [];
    }
}

// ذخیره دیتابیس
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// شروع ربات
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    let users = loadUsers();

    // اگر قبلاً ثبت شده باشد
    const exists = users.find((u) => u.id === userId);
    if (exists) {
        return ctx.reply("شما قبلاً ثبت‌نام کرده‌اید ✅");
    }

    // مرحله 1 → دریافت نام
    await ctx.reply("لطفاً نام و نام خانوادگی خود را ارسال کنید:");
    users.push({
        id: userId,
        step: "name",
    });
    saveUsers(users);
});

// دریافت پیام‌ها
bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    let users = loadUsers();
    let user = users.find((u) => u.id === userId);
    if (!user) return;

    // مرحله نام
    if (user.step === "name") {
        user.name = ctx.message.text;
        user.step = "phone";
        saveUsers(users);

        return ctx.reply(
            "لطفاً روی دکمه زیر بزنید تا شماره تلگرام شما ارسال شود:",
            Markup.keyboard([
                Markup.button.contactRequest("📞 ارسال شماره")
            ]).resize()
        );
    }
});

// دریافت شماره
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

// تایید توافقنامه
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

// ادمین: دریافت لیست کاربران
bot.command("users", (ctx) => {
    if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

    const users = loadUsers();
    let text = "📋 لیست کاربران ثبت‌شده:\n\n";

    users.forEach((u) => {
        text += `👤 ${u.name} — ${u.phone}\n`;
    });

    ctx.reply(text || "کاربری ثبت نشده است.");
});

// اجرای ربات
bot.launch();
console.log("ربات با موفقیت اجرا شد 🚀");
