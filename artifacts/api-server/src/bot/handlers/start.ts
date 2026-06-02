import type { Context } from "grammy";
import { getOrCreateUser } from "../credits";
import { mainMenuKeyboard } from "../keyboards";

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(
    telegramId,
    ctx.from?.username,
    ctx.from?.first_name
  );

  const name = user.firstName || user.username || "Kawan";
  const statusLabel = user.premium ? "⭐ Premium" : "🆓 Gratis";

  await ctx.reply(
    `👋 Selamat datang, *${name}*!\n\n` +
    `🤖 Saya adalah *EditAI Bot* — asisten AI untuk edit foto dan video.\n\n` +
    `📊 *Status akun kamu:*\n` +
    `• Paket: ${statusLabel}\n` +
    `• Sisa kredit hari ini: *${user.credits} kredit*\n\n` +
    `✨ *Apa yang bisa saya lakukan:*\n` +
    `📷 Edit foto (jernihkan, hapus bg, anime, dll)\n` +
    `🎬 Edit video (upscale, subtitle, stabilkan, dll)\n` +
    `🖼️ Ubah foto jadi video cinematic\n` +
    `💬 Chat AI untuk konsultasi editing\n` +
    `🔥 Info tren konten terbaru\n\n` +
    `Kirim foto atau video untuk mulai, atau pilih menu di bawah! 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    }
  );
}
