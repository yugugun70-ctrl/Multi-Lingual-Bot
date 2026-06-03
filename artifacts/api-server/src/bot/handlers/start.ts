import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, NEW_USER_CREDITS, VIDEO_EDIT_COST, TOPUP_TIERS } from "../credits";

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
    .text("🔊 Bersihkan Suara", "menu:audio_denoise")
    .row()
    .text("💳 Top Up Kredit", "menu:topup");
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

// ─── Submenu Subtitle ─────────────────────────────────────────────────────────
export function subtitleMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎙️ Auto (dari suara video)", "menu:auto_subtitle")
    .row()
    .text("✏️ Ketik Teks Manual", "menu:subtitle_manual")
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

// ─── Konfirmasi Posisi Auto Subtitle ─────────────────────────────────────────
export function autoSubtitleConfirmKeyboard(suggestedPos: "top" | "middle" | "bottom"): InlineKeyboard {
  const labels = { top: "⬆️ Atas", middle: "↕️ Tengah", bottom: "⬇️ Bawah" };
  const suggested = labels[suggestedPos];
  return new InlineKeyboard()
    .text(`✅ Pakai Saran AI (${suggested})`, `auto_sub_pos:${suggestedPos}`)
    .row()
    .text("⬆️ Atas", "auto_sub_pos:top").text("↕️ Tengah", "auto_sub_pos:middle").text("⬇️ Bawah", "auto_sub_pos:bottom")
    .row()
    .text("❌ Batal", "menu:back");
}

// ─── Pilihan Paket Top Up ──────────────────────────────────────────────────────
export function topupTiersKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      `${TOPUP_TIERS.starter.label}: Rp ${TOPUP_TIERS.starter.idr.toLocaleString("id-ID")} → ${TOPUP_TIERS.starter.credits} kredit`,
      "topup_tier:starter"
    )
    .row()
    .text(
      `${TOPUP_TIERS.value.label}: Rp ${TOPUP_TIERS.value.idr.toLocaleString("id-ID")} → ${TOPUP_TIERS.value.credits} kredit`,
      "topup_tier:value"
    )
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Teks Top Up (untuk paket tertentu) ───────────────────────────────────────
export function getTopUpText(tierKey?: "starter" | "value"): string {
  const rateInfo =
    `<b>Tarif penggunaan:</b>\n` +
    `🎞️ Semua fitur video → <b>${VIDEO_EDIT_COST} kredit</b>\n` +
    `💬 Chat AI → <b>GRATIS</b>\n\n`;

  if (!tierKey) {
    return (
      `<b>💳 Top Up Kredit EditAI</b>\n\n` +
      `<b>Pilih paket:</b>\n` +
      `• ${TOPUP_TIERS.starter.label}: Rp ${TOPUP_TIERS.starter.idr.toLocaleString("id-ID")} → <b>${TOPUP_TIERS.starter.credits} kredit</b>\n` +
      `• ${TOPUP_TIERS.value.label}: Rp ${TOPUP_TIERS.value.idr.toLocaleString("id-ID")} → <b>${TOPUP_TIERS.value.credits} kredit</b>\n\n` +
      rateInfo
    );
  }

  const tier = TOPUP_TIERS[tierKey];
  return (
    `<b>💳 Top Up — ${tier.label}</b>\n\n` +
    `💰 <b>Transfer:</b> Rp ${tier.idr.toLocaleString("id-ID")} → <b>${tier.credits} kredit</b>\n\n` +
    rateInfo +
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
    `🎞️ Semua fitur video = <b>${VIDEO_EDIT_COST} kredit</b> per proses\n\n` +
    `Pilih layanan 👇`,
    { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
  );
}
