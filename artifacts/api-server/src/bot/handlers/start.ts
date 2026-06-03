import type { Context } from "grammy";
import { getOrCreateUser } from "../credits";

export function getMenuText(): string {
  return (
    `Pilih layanan yang kamu inginkan:\n\n` +
    `1️⃣  *Edit Foto*\n` +
    `      _(hapus background, upscale, anime, dll)_\n\n` +
    `2️⃣  *Teks → Foto*\n` +
    `      _(buat gambar dari deskripsi teks)_\n\n` +
    `3️⃣  *Teks → Video*\n` +
    `      _(buat video dari deskripsi teks)_\n\n` +
    `4️⃣  *Foto → Video*\n` +
    `      _(ubah foto jadi video cinematic)_\n\n` +
    `5️⃣  *Jernihkan Kualitas Video*\n` +
    `      _(denoise, sharpen, warna lebih hidup)_\n\n` +
    `Ketik angka *1–5* untuk mulai.`
  );
}

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(
    telegramId,
    ctx.from?.username,
    ctx.from?.first_name
  );

  const name = user.firstName || user.username || "kamu";

  await ctx.reply(
    `Hei *${name}*! 👋 Selamat datang di *EditAI*\n\n` +
    `Saya asisten AI untuk edit foto dan video.\n` +
    `Saya hanya memahami pertanyaan seputar foto & video editing.\n\n` +
    (user.premium
      ? `⭐ Status: *Premium*\n\n`
      : `🆓 Kuota hari ini: 💬${user.chatQuota} · 📷${user.photoEditQuota} foto · 🎬${user.videoEditQuota} video\n\n`) +
    getMenuText(),
    { parse_mode: "Markdown" }
  );
}
