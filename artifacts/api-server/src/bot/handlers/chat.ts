import type { Context } from "grammy";
import { getAIResponse, clearChatHistory } from "../ai";
import { deductCredit, getOrCreateUser } from "../credits";
import { InlineKeyboard } from "grammy";

export async function handleChatMessage(ctx: Context, text: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

  if (user.banned) {
    await ctx.reply("❌ Akun kamu telah diblokir.");
    return;
  }

  const result = await deductCredit(telegramId);
  if (!result.success) {
    await ctx.reply(
      `❌ *Kredit habis!*\n\nKamu sudah menggunakan semua kredit hari ini.\nKredit akan direset otomatis dalam 24 jam.\n\n💡 Upgrade ke Premium untuk 50 kredit/hari!`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const typingMsg = await ctx.reply("💬 AI sedang mengetik...");

  try {
    const response = await getAIResponse(telegramId, text);
    await ctx.api.deleteMessage(ctx.chat!.id, typingMsg.message_id);
    await ctx.reply(
      `${response}\n\n_💳 Sisa kredit: ${result.remaining}_`,
      { parse_mode: "Markdown" }
    );
  } catch {
    await ctx.api.deleteMessage(ctx.chat!.id, typingMsg.message_id);
    await ctx.reply("❌ Maaf, AI sedang tidak tersedia. Coba lagi nanti.");
  }
}

export async function handleClearChat(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await clearChatHistory(telegramId);

  await ctx.reply(
    `🗑️ *Riwayat chat dihapus!*\n\nPercakapan AI kamu telah direset. Mulai percakapan baru sekarang.`,
    { parse_mode: "Markdown" }
  );
}

export async function handleChatMenu(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("🗑️ Hapus Riwayat Chat", "clear_chat");

  await ctx.reply(
    `💬 *Mode AI Chat*\n\n` +
    `Kamu sekarang bisa mengobrol langsung dengan AI!\n\n` +
    `💡 *Tips:*\n` +
    `• Tanyakan teknik editing foto/video\n` +
    `• Minta rekomendasi style\n` +
    `• Konsultasi tentang konten\n\n` +
    `Ketik pesanmu sekarang! Setiap pesan menggunakan 1 kredit.`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}
