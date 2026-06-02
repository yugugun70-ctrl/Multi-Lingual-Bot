import type { Context } from "grammy";
import { getTrendIdeas } from "../trends";
import { deductCredit, getOrCreateUser } from "../credits";
import { InlineKeyboard } from "grammy";

export async function handleTrendMenu(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("📷 Tren Foto", "trend_foto").row()
    .text("🎬 Tren Video", "trend_video").row()
    .text("💡 Inspirasi Umum", "trend_general");

  await ctx.reply(
    `🔥 *Trend Assistant*\n\nDapatkan ide editing dan inspirasi konten yang sedang viral!`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

export async function handleTrendRequest(ctx: Context, category: "foto" | "video" | "general"): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await ctx.answerCallbackQuery("⏳ Mengambil info tren terbaru...");

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  if (user.banned) {
    await ctx.reply("❌ Akun kamu telah diblokir.");
    return;
  }

  const result = await deductCredit(telegramId);
  if (!result.success) {
    await ctx.reply(
      `❌ *Kredit habis!*\n\nKredit akan direset dalam 24 jam.\n💡 Upgrade ke Premium untuk 50 kredit/hari!`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const loadingMsg = await ctx.reply("🔍 Sedang mengambil tren terbaru...");

  try {
    const ideas = await getTrendIdeas(category);
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    await ctx.reply(
      `🔥 *Tren ${category === "foto" ? "Foto" : category === "video" ? "Video" : "Konten"} Terbaru:*\n\n${ideas}\n\n💳 Sisa kredit: *${result.remaining}*`,
      { parse_mode: "Markdown" }
    );
  } catch {
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    await ctx.reply("❌ Gagal mengambil info tren. Coba lagi nanti.");
  }
}
