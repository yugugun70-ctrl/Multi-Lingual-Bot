import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, NEW_USER_CREDITS, VIDEO_EDIT_COST, TOPUP_AMOUNT_IDR, TOPUP_CREDITS } from "../credits";

function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Menu Utama ───────────────────────────────────────────────────────────────
export function mainInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✨ Jernihkan Video", "menu:jernihkan").text("📐 Kualitas Video", "menu:kualitas")
    .row()
    .text("🎞️ Efek Video", "menu:efek").text("📏 Rasio Video", "menu:rasio")
    .row()
    .text("💬 Tambah Subtitle", "menu:subtitle").text("✂️ Potong Video", "menu:trim")
    .row()
    .text("🎬 Foto → Video", "menu:foto_video")
    .row()
    .text("💳 Top Up Kredit", "menu:topup").text("🎁 Check-in Harian", "menu:checkin");
}

// ─── Submenu Kualitas ─────────────────────────────────────────────────────────
export function kualitasKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📺 HD (720p)", "edit:video_quality_hd")
    .row()
    .text("🖥️ Full HD (1080p)", "edit:video_quality_fhd")
    .row()
    .text("🔮 4K (2160p)", "edit:video_quality_4k")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Efek Video ───────────────────────────────────────────────────────
export function efekVideoKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎬 Sinematik", "edit:video_effect_cinematic").text("⬛ Hitam & Putih", "edit:video_effect_bw")
    .row()
    .text("📽️ Vintage/Retro", "edit:video_effect_vintage").text("🎭 Drama", "edit:video_effect_drama")
    .row()
    .text("💥 Vivid/Cerah", "edit:video_effect_vivid")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Rasio Video ──────────────────────────────────────────────────────
export function rasioVideoKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("▬ 16:9 Landscape", "edit:video_ratio_16_9").text("▮ 9:16 Reels", "edit:video_ratio_9_16")
    .row()
    .text("■ 1:1 Square", "edit:video_ratio_1_1").text("▭ 4:3 Klasik", "edit:video_ratio_4_3")
    .row()
    .text("▬▬ 21:9 Sinema", "edit:video_ratio_21_9")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Posisi Subtitle ──────────────────────────────────────────────────
export function subtitlePosKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⬆️ Teks di Atas", "subtitle_pos:top")
    .row()
    .text("↕️ Teks di Tengah", "subtitle_pos:middle")
    .row()
    .text("⬇️ Teks di Bawah", "subtitle_pos:bottom")
    .row()
    .text("◀️ Menu Utama", "menu:back");
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

// ─── Teks Top Up ──────────────────────────────────────────────────────────────
export function getTopUpText(): string {
  return (
    `<b>💳 Top Up Kredit EditAI</b>\n\n` +
    `💰 <b>Harga:</b> Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} → <b>${TOPUP_CREDITS} kredit</b>\n\n` +
    `<b>Tarif penggunaan:</b>\n` +
    `🎞️ Semua fitur video → <b>${VIDEO_EDIT_COST} kredit</b>\n` +
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

// ─── Handler /start ───────────────────────────────────────────────────────────
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
    `\n\nSaya asisten AI untuk <b>edit video</b> profesional.\n\n` +
    `💳 Kredit kamu: <b>${user.credits} kredit</b>\n` +
    `🎞️ Semua fitur video = <b>${VIDEO_EDIT_COST} kredit</b> per proses\n` +
    `🎁 Check-in harian = <b>kredit gratis!</b>\n\n` +
    `Pilih layanan 👇`,
    { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
  );
}
