import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, NEW_USER_CREDITS, VIDEO_EDIT_COST, TOPUP_TIERS } from "../credits";

function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Menu Utama ───────────────────────────────────────────────────────────────
export function mainInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎨 Perbaiki Video",      "menu:perbaiki")
    .text("📺 Resolusi & Rasio",    "menu:resolusi_rasio")
    .row()
    .text("📝 Subtitle",            "menu:subtitle")
    .text("🗑️ Hapus Watermark",    "menu:watermark")
    .row()
    .text("💳 Top Up Kredit",       "menu:topup");
}

// ─── Submenu Perbaiki Video ───────────────────────────────────────────────────
export function perbaikiKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✨ Standar — Cepat & Bersih",    "perbaiki:standard")
    .row()
    .text("💎 Pro — Kualitas Tinggi",        "perbaiki:pro")
    .row()
    .text("🌈 HDR — Warna Premium",          "perbaiki:hdr")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Resolusi ─────────────────────────────────────────────────────────
export function resolusiKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📱 Original",       "resolusi:original")
    .text("🎥 HD (720p)",      "resolusi:hd")
    .row()
    .text("✨ Full HD (1080p)", "resolusi:fhd")
    .text("👑 4K (2160p)",     "resolusi:4k")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Rasio ────────────────────────────────────────────────────────────
export function rasioKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📱 9:16 (TikTok/Reels)", "rasio:9_16")
    .text("🖼️ 1:1 (Feed)",          "rasio:1_1")
    .row()
    .text("🎬 16:9 (YouTube)",       "rasio:16_9")
    .text("🔄 Pertahankan Asli",     "rasio:keep")
    .row()
    .text("◀️ Pilih Resolusi Lagi", "menu:resolusi_rasio");
}

// ─── Submenu Subtitle (pilih mode) ────────────────────────────────────────────
export function subtitleMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎙️ Otomatis (dari suara)", "subtitle_mode:auto")
    .row()
    .text("✏️ Teks Manual",            "subtitle_mode:manual")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Gaya Subtitle (Auto) ─────────────────────────────────────────────
export function subtitleStyleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📝 Classic",           "subtitle_style:classic")
    .row()
    .text("📱 TikTok Style",      "subtitle_style:tiktok")
    .row()
    .text("🎬 CapCut Style",      "subtitle_style:capcut")
    .row()
    .text("◀️ Kembali", "menu:subtitle");
}

// ─── Submenu Posisi Subtitle (Auto) ───────────────────────────────────────────
export function subtitlePosKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⬆️ Atas", "subtitle_pos:top")
    .text("↕️ Tengah", "subtitle_pos:middle")
    .text("⬇️ Bawah", "subtitle_pos:bottom")
    .row()
    .text("🎯 Kustom (0–100)", "subtitle_pos:custom")
    .row()
    .text("◀️ Pilih Gaya Lagi", "menu:subtitle_auto_style");
}

// ─── Submenu Gaya Teks Manual ──────────────────────────────────────────────────
export function manualSubStyleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✨ Bold White",         "mansub_style:bold_white")
    .row()
    .text("💛 TikTok Yellow",      "mansub_style:tiktok_yellow")
    .row()
    .text("🔥 Neon Orange",        "mansub_style:neon_orange")
    .row()
    .text("💎 CapCut Minimal",     "mansub_style:capcut_minimal")
    .row()
    .text("🎬 Cinematic Bar",      "mansub_style:cinematic")
    .row()
    .text("◀️ Kembali", "menu:subtitle");
}

// ─── Submenu Posisi Teks Manual ────────────────────────────────────────────────
export function manualSubPosKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⬆️ Atas",    "mansub_pos:top")
    .text("↕️ Tengah",  "mansub_pos:middle")
    .text("⬇️ Bawah",   "mansub_pos:bottom")
    .row()
    .text("◀️ Pilih Gaya Lagi", "menu:subtitle_manual_style");
}

// ─── Submenu Hapus Watermark — Posisi ─────────────────────────────────────────
export function watermarkPosKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("↖️ Kiri Atas",   "wm_pos:top_left")
    .text("↗️ Kanan Atas",  "wm_pos:top_right")
    .row()
    .text("↙️ Kiri Bawah",  "wm_pos:bottom_left")
    .text("↘️ Kanan Bawah", "wm_pos:bottom_right")
    .row()
    .text("🎯 Tengah",       "wm_pos:center")
    .row()
    .text("◀️ Menu Utama", "menu:back");
}

// ─── Submenu Hapus Watermark — Ukuran ─────────────────────────────────────────
export function watermarkSizeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("S — Kecil (≤10% lebar)",    "wm_size:small")
    .row()
    .text("M — Sedang (≈20% lebar)",   "wm_size:medium")
    .row()
    .text("L — Besar (≈30% lebar)",    "wm_size:large")
    .row()
    .text("◀️ Pilih Posisi Lagi", "menu:watermark");
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

// ─── Teks Top Up ──────────────────────────────────────────────────────────────
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
      : "Selamat datang kembali di <b>EditAI</b>! ✂️") +
    `\n\n` +
    `<b>Studio edit video profesional di Telegram</b>\n\n` +
    `🎨 Perbaiki kualitas video\n` +
    `📺 Ubah resolusi &amp; rasio\n` +
    `📝 Subtitle otomatis atau manual\n` +
    `🗑️ Hapus watermark\n\n` +
    `💳 Kredit kamu: <b>${user.credits} kredit</b>\n` +
    `🎞️ Semua fitur = <b>${VIDEO_EDIT_COST} kredit</b>\n\n` +
    `<i>Kirim video dan pilih layanan 👇</i>`,
    { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
  );
}
