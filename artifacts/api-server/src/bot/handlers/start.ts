import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, NEW_USER_CREDITS, PHOTO_EDIT_COST, VIDEO_EDIT_COST, TOPUP_AMOUNT_IDR, TOPUP_CREDITS } from "../credits";

function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Menu utama ───────────────────────────────────────────────────────────────
export function mainInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📷 Edit Foto", "menu:edit_foto").text("🎞️ Foto → Video", "menu:foto_video")
    .row()
    .text("🖼️ Teks → Foto", "menu:teks_foto").text("✨ Jernihkan Video", "menu:jernihkan")
    .row()
    .text("💳 Top Up Kredit", "menu:topup");
}

// ─── Submenu Edit Foto (halaman 1: dasar) ─────────────────────────────────────
export function editFotoKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔲 Hapus Background", "edit:remove_background").text("🔍 Perjelas 3x", "edit:upscale_photo")
    .row()
    .text("✨ Perbaiki Kualitas", "edit:enhance_photo").text("🎨 Efek Anime", "edit:anime_effect")
    .row()
    .text("🎭 Efek Kartun", "edit:cartoon_effect").text("🌈 Koreksi Warna", "edit:color_correction")
    .row()
    .text("🔮 Efek Trending ▶", "menu:edit_trendy")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Edit Foto (halaman 2: trending effects) ──────────────────────────
export function editFotoTrendyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🌟 Efek HDR", "edit:hdr_effect").text("✨ Efek Glow", "edit:glow_effect")
    .row()
    .text("✏️ Efek Sketsa", "edit:sketch_effect").text("💜 Efek Neon", "edit:neon_effect")
    .row()
    .text("🖌️ Lukis Minyak", "edit:oil_paint_effect").text("📽️ Efek Vintage", "edit:vintage_effect")
    .row()
    .text("◀️ Edit Foto Dasar", "menu:edit_foto");
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
    .text("◀️ Menu Utama", "menu:back");
}

export function getTopUpText(): string {
  return (
    `<b>💳 Top Up Kredit EditAI</b>\n\n` +
    `💰 <b>Harga:</b> Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} → <b>${TOPUP_CREDITS} kredit</b>\n\n` +
    `<b>Tarif penggunaan:</b>\n` +
    `📷 Edit Foto → <b>${PHOTO_EDIT_COST} kredit</b>\n` +
    `🎞️ Foto/Video → <b>${VIDEO_EDIT_COST} kredit</b>\n` +
    `💬 Chat AI → <b>GRATIS</b>\n\n` +
    `<b>Cara Top Up:</b>\n` +
    `1. Transfer ke salah satu rekening di bawah\n` +
    `2. Kirim screenshot bukti transfer ke chat ini\n` +
    `3. Admin menambahkan kredit dalam 1×24 jam\n\n` +
    `🏦 <b>Bank BNI:</b> <code>1939716011</code>\n` +
    `📱 <b>GoPay:</b> <code>085641452357</code>\n\n` +
    `<i>Setelah transfer, kirim foto/screenshot bukti ke chat ini.</i>`
  );
}

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user  = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name  = escHtml(user.firstName || user.username || "kamu");
  const isNew = (Date.now() - new Date(user.registerDate).getTime()) < 10_000;

  await ctx.reply(
    `Hei <b>${name}</b>! 👋 ` +
    (isNew
      ? `Selamat datang di <b>EditAI</b>!\n\nKamu dapat <b>${NEW_USER_CREDITS} kredit gratis</b> untuk memulai! 🎉`
      : "Selamat datang kembali!") +
    `\n\nSaya asisten AI untuk <b>edit foto &amp; video</b>.\n\n` +
    `💳 Kredit kamu: <b>${user.credits} kredit</b>\n` +
    `📷 Edit Foto = <b>${PHOTO_EDIT_COST} kredit</b> | 🎞️ Video = <b>${VIDEO_EDIT_COST} kredit</b>\n\n` +
    `Pilih layanan 👇`,
    { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
  );
}
