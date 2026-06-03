import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, NEW_USER_CREDITS, PHOTO_EDIT_COST, VIDEO_EDIT_COST, TOPUP_AMOUNT_IDR, TOPUP_CREDITS } from "../credits";

// ─── Menu utama ───────────────────────────────────────────────────────────────
export function mainInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📷 Edit Foto", "menu:edit_foto").text("🎞️ Foto → Video", "menu:foto_video")
    .row()
    .text("🖼️ Teks → Foto", "menu:teks_foto").text("✨ Jernihkan Video", "menu:jernihkan")
    .row()
    .text("💳 Top Up Kredit", "menu:topup");
}

// ─── Submenu Edit Foto ────────────────────────────────────────────────────────
export function editFotoKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔲 Hapus Background", "edit:remove_background").text("🔍 Perjelas 3x", "edit:upscale_photo")
    .row()
    .text("✨ Perbaiki Kualitas", "edit:enhance_photo").text("🎨 Efek Anime", "edit:anime_effect")
    .row()
    .text("🎭 Efek Kartun", "edit:cartoon_effect").text("🖌️ Koreksi Warna", "edit:color_correction")
    .row()
    .text("◀️ Kembali ke Menu", "menu:back");
}

// ─── Submenu Foto → Video ─────────────────────────────────────────────────────
export function fotoVideoKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎬 Efek Sinematik", "edit:photo_to_video_cinematic")
    .row()
    .text("🔎 Efek Zoom In", "edit:photo_to_video_zoom")
    .row()
    .text("↔️ Efek Pan", "edit:photo_to_video_pan")
    .row()
    .text("◀️ Kembali ke Menu", "menu:back");
}

export function getTopUpText(): string {
  return (
    `💳 *Top Up Kredit EditAI*\n\n` +
    `💰 *Harga:* Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} → *${TOPUP_CREDITS} kredit*\n\n` +
    `*Tarif penggunaan:*\n` +
    `📷 Edit Foto → *${PHOTO_EDIT_COST} kredit*\n` +
    `🎞️ Foto/Video → *${VIDEO_EDIT_COST} kredit*\n` +
    `💬 Chat AI → *GRATIS*\n\n` +
    `*Cara Top Up:*\n` +
    `1. Transfer ke salah satu rekening di bawah\n` +
    `2. Kirim screenshot bukti transfer ke chat ini\n` +
    `3. Admin akan menambahkan kredit dalam 1×24 jam\n\n` +
    `🏦 *Bank BNI:* \`1939716011\`\n` +
    `📱 *GoPay:* \`085641452357\`\n\n` +
    `_Setelah transfer, kirim foto/screenshot bukti ke chat ini._`
  );
}

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || "kamu";
  const isNew = (Date.now() - new Date(user.registerDate).getTime()) < 10000;

  await ctx.reply(
    `Hei *${name}*! 👋 ${isNew ? `Selamat datang di *EditAI*!\n\nKamu dapat *${NEW_USER_CREDITS} kredit gratis* untuk memulai. 🎉` : "Selamat datang kembali!"}\n\n` +
    `Saya asisten AI untuk *edit foto & video*.\n\n` +
    `💳 Kredit kamu: *${user.credits} kredit*\n` +
    `📷 Edit Foto = *${PHOTO_EDIT_COST} kredit* | 🎞️ Video = *${VIDEO_EDIT_COST} kredit*\n\n` +
    `Pilih layanan 👇`,
    { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
  );
}
