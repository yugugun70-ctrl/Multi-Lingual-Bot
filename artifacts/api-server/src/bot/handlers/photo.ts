import type { Context } from "grammy";
import { deductCredit, getOrCreateUser } from "../credits";
import { afterReceivePhotoKeyboard } from "../keyboards";

const featureDescriptions: Record<string, string> = {
  photo_enhance: "✨ Jernihkan Foto",
  photo_upscale: "🔍 Upscale Resolusi",
  photo_remove_object: "🗑️ Hapus Objek",
  photo_remove_bg: "✂️ Hapus Background",
  photo_replace_bg: "🏞️ Ganti Background",
  photo_color: "🎨 Koreksi Warna",
  photo_portrait: "💄 Portrait Enhancement",
  photo_style: "🖌️ Style Transfer",
  photo_cartoon: "🎭 Efek Kartun",
  photo_anime: "🌸 Efek Anime",
};

export async function handlePhotoReceived(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await ctx.reply(
    `📷 *Foto diterima!*\n\nApa yang ingin kamu lakukan dengan foto ini?\nPilih fitur editing di bawah:`,
    {
      parse_mode: "Markdown",
      reply_markup: afterReceivePhotoKeyboard(),
    }
  );
}

export async function handlePhotoEdit(ctx: Context, action: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await ctx.answerCallbackQuery();

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

  if (user.banned) {
    await ctx.reply("❌ Akun kamu telah diblokir. Hubungi admin untuk informasi lebih lanjut.");
    return;
  }

  const result = await deductCredit(telegramId);

  if (!result.success) {
    await ctx.reply(
      `❌ *Kredit habis!*\n\n` +
      `Kamu sudah menggunakan semua kredit hari ini.\n` +
      `Kredit akan direset otomatis setelah 24 jam.\n\n` +
      `💡 *Upgrade ke Premium* untuk mendapatkan 50 kredit per hari!\n` +
      `Hubungi admin: /premium`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const featureName = featureDescriptions[action] || action;

  await ctx.reply(
    `⚙️ *Memproses: ${featureName}*\n\n` +
    `⏳ Foto kamu sedang diproses...\n\n` +
    `💡 *Catatan:* Fitur AI editing sedang dalam pengembangan. ` +
    `Hasil editing akan segera tersedia setelah integrasi API editing selesai.\n\n` +
    `💳 Sisa kredit: *${result.remaining} kredit*`,
    { parse_mode: "Markdown" }
  );
}
