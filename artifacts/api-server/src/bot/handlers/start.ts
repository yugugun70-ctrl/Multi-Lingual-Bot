import type { Context } from "grammy";
import { Keyboard } from "grammy";
import { getOrCreateUser, NEW_USER_CREDITS, PHOTO_EDIT_COST, VIDEO_EDIT_COST, TOPUP_AMOUNT_IDR, TOPUP_CREDITS } from "../credits";

// ─── Keyboard tombol utama (muncul di bawah layar) ───────────────────────────

export const mainKeyboard = new Keyboard()
  .text("📷 Edit Foto").text("🎞️ Foto → Video")
  .row()
  .text("🖼️ Teks → Foto").text("✨ Jernihkan Video")
  .row()
  .text("💳 Top Up Credit")
  .resized()
  .persistent();

export function getTopUpText(): string {
  return (
    `💳 *Top Up Kredit EditAI*\n\n` +
    `💰 *Harga:* Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} → *${TOPUP_CREDITS} kredit*\n\n` +
    `*Tarif penggunaan:*\n` +
    `📷 Edit Foto → *${PHOTO_EDIT_COST} kredit*\n` +
    `🎞️ Foto/Video → *${VIDEO_EDIT_COST} kredit*\n` +
    `💬 Chat AI → *GRATIS*\n\n` +
    `*Cara Top Up:*\n` +
    `1. Transfer Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} ke rekening admin\n` +
    `2. Kirim screenshot bukti transfer ke chat ini\n` +
    `3. Admin akan menambahkan kredit dalam 1×24 jam\n\n` +
    `_Hubungi admin untuk info rekening pembayaran._`
  );
}

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || "kamu";
  const isNew = (Date.now() - new Date(user.registerDate).getTime()) < 10000;

  await ctx.reply(
    `Hei *${name}*! 👋 ${isNew ? "Selamat datang di *EditAI*!\n\nKamu dapat *20 kredit gratis* untuk memulai. 🎉" : "Selamat datang kembali!"}\n\n` +
    `Saya asisten AI untuk *edit foto & video*.\n` +
    `💬 Chat dengan saya *gratis* — kredit hanya dipotong saat produksi berhasil.\n\n` +
    `💳 Kredit kamu: *${user.credits} kredit*\n` +
    `📷 Edit Foto = *1 kredit* | 🎞️ Edit Video = *3 kredit*\n\n` +
    `Pilih layanan di bawah ini 👇`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard }
  );
}
