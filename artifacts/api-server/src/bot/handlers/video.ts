import type { Context } from "grammy";
import { deductCredit, getOrCreateUser } from "../credits";
import { afterReceiveVideoKeyboard } from "../keyboards";

const featureDescriptions: Record<string, string> = {
  video_upscale: "🔍 Video Upscale",
  video_stabilize: "📽️ Stabilisasi Video",
  video_noise: "🔇 Hapus Noise",
  video_subtitle: "📝 Generate Subtitle",
  video_caption: "💬 Auto Caption",
  video_resize: "📐 Resize Video",
  video_watermark: "💧 Watermark",
  p2v_cinematic: "🎬 Cinematic Movement",
  p2v_zoom: "🔎 Zoom Effect",
  p2v_pan: "↔️ Pan Effect",
  p2v_animate: "🤖 AI Animation",
};

export async function handleVideoReceived(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await ctx.reply(
    `🎬 *Video diterima!*\n\nApa yang ingin kamu lakukan dengan video ini?\nPilih fitur editing di bawah:`,
    {
      parse_mode: "Markdown",
      reply_markup: afterReceiveVideoKeyboard(),
    }
  );
}

export async function handleVideoEdit(ctx: Context, action: string): Promise<void> {
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
    `⏳ Video kamu sedang diproses...\n\n` +
    `💡 *Catatan:* Fitur AI editing video sedang dalam pengembangan. ` +
    `Hasil editing akan segera tersedia setelah integrasi API editing selesai.\n\n` +
    `💳 Sisa kredit: *${result.remaining} kredit*`,
    { parse_mode: "Markdown" }
  );
}
