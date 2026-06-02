import { Bot, GrammyError, HttpError } from "grammy";
import { logger } from "../lib/logger";
import { handleStart } from "./handlers/start";
import { handlePhotoReceived, handlePhotoEdit } from "./handlers/photo";
import { handleVideoReceived, handleVideoEdit } from "./handlers/video";
import { handleChatMessage, handleClearChat, handleChatMenu } from "./handlers/chat";
import { handleCreditInfo } from "./handlers/credit_info";
import { handleTrendMenu, handleTrendRequest } from "./handlers/trend";
import { handleAdminPanel, handleAdminUsers, handleAdminStats, handleAddCredit, handleRemoveCredit, handleSetPremium, handleBan, handleBroadcast } from "./handlers/admin";
import { mainMenuKeyboard, photoEditKeyboard, videoEditKeyboard, photoToVideoKeyboard } from "./keyboards";

const PHOTO_ACTIONS = ["photo_enhance", "photo_upscale", "photo_remove_object", "photo_remove_bg", "photo_replace_bg", "photo_color", "photo_portrait", "photo_style", "photo_cartoon", "photo_anime"];
const VIDEO_ACTIONS = ["video_upscale", "video_stabilize", "video_noise", "video_subtitle", "video_caption", "video_resize", "video_watermark", "p2v_cinematic", "p2v_zoom", "p2v_pan", "p2v_animate"];

const chatModeUsers = new Set<number>();

export function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN harus diset.");

  const bot = new Bot(token);

  bot.command("start", (ctx) => handleStart(ctx));

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `🤖 *Bantuan EditAI Bot*\n\n` +
      `*Perintah Utama:*\n` +
      `/start — Mulai bot & lihat menu\n` +
      `/help — Tampilkan bantuan\n` +
      `/kredit — Cek sisa kredit\n` +
      `/chat — Mulai AI chat\n` +
      `/clearchat — Hapus riwayat AI chat\n` +
      `/trend — Lihat tren konten\n\n` +
      `*Cara Pakai:*\n` +
      `📷 Kirim foto → pilih fitur editing\n` +
      `🎬 Kirim video → pilih fitur editing\n` +
      `💬 Ketik pesan → chat dengan AI\n\n` +
      `*Admin (khusus admin):*\n` +
      `/users — Daftar user\n` +
      `/stats — Statistik bot\n` +
      `/premium [id] — Toggle premium user\n` +
      `/addcredit [id] [jumlah] — Tambah kredit\n` +
      `/removecredit [id] [jumlah] — Kurangi kredit\n` +
      `/broadcast [pesan] — Kirim pesan ke semua user\n` +
      `/ban [id] — Blokir user\n` +
      `/unban [id] — Buka blokir user`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("kredit", (ctx) => handleCreditInfo(ctx));
  bot.command("chat", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) chatModeUsers.add(telegramId);
    await handleChatMenu(ctx);
  });
  bot.command("clearchat", (ctx) => handleClearChat(ctx));
  bot.command("trend", (ctx) => handleTrendMenu(ctx));

  bot.command("admin", (ctx) => handleAdminPanel(ctx));
  bot.command("users", (ctx) => handleAdminUsers(ctx));
  bot.command("stats", (ctx) => handleAdminStats(ctx));

  bot.command("premium", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) || [];
    if (args.length > 0 && args[0]) {
      await handleSetPremium(ctx, args);
    } else {
      await ctx.reply(
        `⭐ *Upgrade ke Premium*\n\n` +
        `Dapatkan *50 kredit per hari* dengan paket Premium!\n\n` +
        `Hubungi admin untuk info harga dan pembayaran.`,
        { parse_mode: "Markdown" }
      );
    }
  });

  bot.command("addcredit", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) || [];
    await handleAddCredit(ctx, args);
  });

  bot.command("removecredit", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) || [];
    await handleRemoveCredit(ctx, args);
  });

  bot.command("broadcast", async (ctx) => {
    const message = ctx.match?.toString().trim() || "";
    await handleBroadcast(ctx, message);
  });

  bot.command("ban", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) || [];
    await handleBan(ctx, args, true);
  });

  bot.command("unban", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) || [];
    await handleBan(ctx, args, false);
  });

  bot.on("message:photo", (ctx) => handlePhotoReceived(ctx));
  bot.on("message:video", (ctx) => handleVideoReceived(ctx));
  bot.on("message:document", async (ctx) => {
    await ctx.reply("📎 File diterima! Untuk editing, kirim foto atau video langsung (bukan sebagai file/dokumen).");
  });

  bot.hears("📷 Edit Foto", async (ctx) => {
    await ctx.reply("📷 *Menu Edit Foto*\n\nPilih fitur yang ingin kamu gunakan:", {
      parse_mode: "Markdown",
      reply_markup: photoEditKeyboard(),
    });
  });

  bot.hears("🎬 Edit Video", async (ctx) => {
    await ctx.reply("🎬 *Menu Edit Video*\n\nPilih fitur yang ingin kamu gunakan:", {
      parse_mode: "Markdown",
      reply_markup: videoEditKeyboard(),
    });
  });

  bot.hears("🖼️ Foto ke Video", async (ctx) => {
    await ctx.reply("🖼️ *Foto ke Video*\n\nKirim foto terlebih dahulu, lalu pilih efek:", {
      parse_mode: "Markdown",
      reply_markup: photoToVideoKeyboard(),
    });
  });

  bot.hears("🔥 Trend Assistant", (ctx) => handleTrendMenu(ctx));
  bot.hears("💬 AI Chat", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) chatModeUsers.add(telegramId);
    await handleChatMenu(ctx);
  });
  bot.hears("💳 Kredit Saya", (ctx) => handleCreditInfo(ctx));

  bot.callbackQuery("back_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("🏠 *Menu Utama*", {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.callbackQuery("clear_chat", async (ctx) => {
    await ctx.answerCallbackQuery("✅ Riwayat chat dihapus");
    await handleClearChat(ctx);
  });

  bot.callbackQuery("admin_users", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleAdminUsers(ctx);
  });

  bot.callbackQuery("admin_stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleAdminStats(ctx);
  });

  bot.callbackQuery("admin_broadcast", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Gunakan perintah: /broadcast [pesan kamu]");
  });

  for (const action of PHOTO_ACTIONS) {
    bot.callbackQuery(action, (ctx) => handlePhotoEdit(ctx, action));
  }

  for (const action of VIDEO_ACTIONS) {
    bot.callbackQuery(action, (ctx) => handleVideoEdit(ctx, action));
  }

  bot.callbackQuery("trend_foto", (ctx) => handleTrendRequest(ctx, "foto"));
  bot.callbackQuery("trend_video", (ctx) => handleTrendRequest(ctx, "video"));
  bot.callbackQuery("trend_general", (ctx) => handleTrendRequest(ctx, "general"));

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const telegramId = ctx.from?.id;

    if (!text || text.startsWith("/")) return;
    if (!telegramId) return;

    const menuTexts = ["📷 Edit Foto", "🎬 Edit Video", "🖼️ Foto ke Video", "🔥 Trend Assistant", "💬 AI Chat", "💳 Kredit Saya"];
    if (menuTexts.includes(text)) return;

    await handleChatMessage(ctx, text);
  });

  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error({ err: err.error, update: ctx.update }, "Bot error");
    if (err.error instanceof GrammyError) {
      logger.error({ description: err.error.description }, "GrammyError");
    } else if (err.error instanceof HttpError) {
      logger.error({ error: err.error }, "HttpError");
    }
  });

  return bot;
}
