import { Bot, GrammyError, HttpError, InputFile } from "grammy";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import {
  handleStart,
  mainInlineKeyboard,
  perbaikiKeyboard,
  resolusiKeyboard,
  rasioKeyboard,
  subtitleMainKeyboard,
  subtitleStyleKeyboard,
  subtitlePosKeyboard,
  manualSubStyleKeyboard,
  manualSubPosKeyboard,
  watermarkPosKeyboard,
  watermarkSizeKeyboard,
  topupTiersKeyboard,
  getTopUpText,
} from "./handlers/start";
import { handleCreditInfo, handleAkunInfo } from "./handlers/credit_info";
import { handleTopUp, handleTopUpTier, handlePaymentProof, handleAdminApprove } from "./handlers/premium";
import {
  handleAdminUsers, handleAdminStats, handleAddQuota, handleRemoveQuota,
  handleBan, handleBroadcast, handleTestStatus, isAdmin,
} from "./handlers/admin";
import { runAgent, clearHistory } from "./agent";
import {
  getOrCreateUser, checkCredits, deductCredits,
  getCreditCost, getCreditErrorMessage, VIDEO_EDIT_COST,
} from "./credits";
import type { TopupTierKey } from "./credits";
import { getUserState, setUserState, clearPending } from "./state";
import type { SubtitleStyle, ManualSubtitleStyle, WatermarkPosition, WatermarkSize } from "./state";
import { executeEditAction, videoAutoSubtitle, videoManualSubtitle, videoRemoveWatermark } from "./tools";
import { transcribeVideo, getVideoInfo } from "../lib/transcribe";
import { bufferToTempFile } from "../lib/image-processor";
import type { EditAction } from "./state";

// ─── Helper: download buffer ──────────────────────────────────────────────────
async function downloadBuffer(fileUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proto = fileUrl.startsWith("https") ? https : http;
    proto.get(fileUrl, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── Helper: kirim hasil edit ─────────────────────────────────────────────────
async function sendEditResult(ctx: any, outputUrl: string, isVideo: boolean, caption: string): Promise<void> {
  const kb = mainInlineKeyboard();
  if (isVideo) {
    if (outputUrl.startsWith("data:video")) {
      const buf = Buffer.from(outputUrl.split(",")[1], "base64");
      await ctx.replyWithVideo(new InputFile(buf, "editai_video.mp4"), { caption, supports_streaming: true, reply_markup: kb, parse_mode: "HTML" });
    } else {
      await ctx.replyWithVideo(outputUrl, { caption, reply_markup: kb, parse_mode: "HTML" });
    }
    return;
  }
  if (outputUrl.startsWith("data:image")) {
    const ext = outputUrl.startsWith("data:image/png") ? "png" : "jpg";
    const buf = Buffer.from(outputUrl.split(",")[1], "base64");
    await ctx.replyWithPhoto(new InputFile(buf, `editai.${ext}`), { caption, reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.replyWithPhoto(outputUrl, { caption, reply_markup: kb, parse_mode: "HTML" });
  }
}

// ─── Jalankan edit action ──────────────────────────────────────────────────────
async function runEditAction(
  ctx: any, telegramId: number, action: EditAction,
  fileUrl: string, fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<void> {
  const cost = getCreditCost(action);
  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
    return;
  }

  await ctx.reply("⏳ Sedang diproses...\n<i>10–120 detik, harap tunggu. Kredit dipotong hanya jika berhasil.</i>", { parse_mode: "HTML" });
  await ctx.replyWithChatAction("upload_video");

  try {
    const result = await executeEditAction(action, fileUrl, fileType, extraParams);

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ <b>Gagal:</b> ${result.error ?? "Terjadi kesalahan"}\n\n<i>Kredit tidak dikurangi.</i>`,
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    setUserState(telegramId, { lastVideoFileUrl: null, lastVideoFileId: null, pendingAction: null, menuMode: null });

    const caption =
      `${result.message ?? "✅ Selesai!"}\n` +
      (cost > 0 ? `<i>-${cost} kredit | Sisa: ${deducted.remaining} kredit</i>` : "") +
      `\n\n📤 <i>Kirim video baru untuk edit lagi.</i>`;

    await sendEditResult(ctx, result.outputUrl, result.isVideo ?? true, caption);
  } catch (err: any) {
    logger.error({ err }, "Edit execution error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\n<i>Kredit tidak dikurangi.</i>`,
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
  }
}

// ─── Subtitle Otomatis — Transkripsi + Tempel ─────────────────────────────────
async function runSubtitleProcess(
  ctx: any,
  telegramId: number,
  videoUrl: string,
  style: SubtitleStyle,
  position: "top" | "middle" | "bottom" | "custom",
  customYPercent: number
): Promise<void> {
  const cost = VIDEO_EDIT_COST;
  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
    return;
  }

  if (getUserState(telegramId).isTranscribing) {
    await ctx.reply("⏳ Transkripsi sedang berjalan, harap tunggu...");
    return;
  }

  const styleLabel: Record<SubtitleStyle, string> = { classic: "Classic 📝", tiktok: "TikTok Style 📱", capcut: "CapCut Style 🎬" };
  const posLabel = { top: "Atas ⬆️", middle: "Tengah ↕️", bottom: "Bawah ⬇️", custom: `Kustom ${customYPercent}% 🎯` }[position];

  setUserState(telegramId, { isTranscribing: true });
  await ctx.reply(
    `🎙️ <b>Subtitle Otomatis dimulai...</b>\n\n` +
    `🎨 Gaya: <b>${styleLabel[style]}</b>\n` +
    `📍 Posisi: <b>${posLabel}</b>\n\n` +
    `<i>Mengekstrak audio → transkripsi AI → tempel subtitle...\n(15–90 detik)</i>`,
    { parse_mode: "HTML" }
  );
  await ctx.replyWithChatAction("upload_video");

  try {
    const buf     = await downloadBuffer(videoUrl);
    const tmpPath = await bufferToTempFile(buf, "mp4");
    const [transcript] = await Promise.all([transcribeVideo(tmpPath), getVideoInfo(tmpPath)]);
    await import("node:fs/promises").then(m => m.unlink(tmpPath)).catch(() => {});

    if (!transcript.success || !transcript.segments || transcript.segments.length === 0) {
      setUserState(telegramId, { isTranscribing: false });
      await ctx.reply(
        `❌ <b>Suara tidak terdeteksi.</b>\n\n${transcript.error ?? "Pastikan video memiliki audio jelas."}\n\n` +
        `<i>Tips: Gunakan video tanpa musik latar yang kencang, dan suara percakapan yang jelas.</i>`,
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    logger.info({ provider: transcript.provider, segs: transcript.segments.length }, "Transkripsi selesai");

    await ctx.reply(
      `✅ <b>${transcript.segments.length} segmen terdeteksi</b> via ${transcript.provider ?? "AI"}\n` +
      `⏳ Menempel subtitle ke video...`,
      { parse_mode: "HTML" }
    );

    const result = await videoAutoSubtitle(videoUrl, transcript.segments, position, style, customYPercent);
    setUserState(telegramId, { isTranscribing: false });

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ Gagal menempel subtitle: ${result.error ?? "Kesalahan tidak diketahui"}\n\n<i>Kredit tidak dikurangi.</i>`,
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    setUserState(telegramId, { lastVideoFileUrl: null, lastVideoFileId: null, pendingAction: null, menuMode: null });

    const caption =
      `${result.message ?? "✅ Subtitle selesai!"}\n` +
      `<i>-${cost} kredit | Sisa: ${deducted.remaining} kredit</i>\n\n` +
      `📤 <i>Kirim video baru untuk edit lagi.</i>`;

    await sendEditResult(ctx, result.outputUrl, true, caption);
  } catch (err: any) {
    setUserState(telegramId, { isTranscribing: false });
    logger.error({ err }, "Subtitle process error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\n<i>Kredit tidak dikurangi.</i>`,
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
  }
}

// ─── Manual Subtitle — Tempel Teks ────────────────────────────────────────────
async function runManualSubtitleProcess(
  ctx: any,
  telegramId: number,
  videoUrl: string,
  text: string,
  style: ManualSubtitleStyle,
  position: "top" | "middle" | "bottom"
): Promise<void> {
  const cost = VIDEO_EDIT_COST;
  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
    return;
  }

  const styleLabel: Record<ManualSubtitleStyle, string> = {
    bold_white: "Bold White ✨", tiktok_yellow: "TikTok Yellow 💛",
    neon_orange: "Neon Orange 🔥", capcut_minimal: "CapCut Minimal 💎",
    cinematic: "Cinematic Bar 🎬",
  };
  const posLabel = { top: "Atas", middle: "Tengah", bottom: "Bawah" }[position];

  await ctx.reply(
    `✏️ <b>Menempel teks...</b>\n\n` +
    `🎨 Gaya: <b>${styleLabel[style]}</b>\n` +
    `📍 Posisi: <b>${posLabel}</b>\n\n` +
    `<i>Memproses... (5–30 detik)</i>`,
    { parse_mode: "HTML" }
  );
  await ctx.replyWithChatAction("upload_video");

  try {
    const result = await videoManualSubtitle(videoUrl, text, style, position);

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ Gagal: ${result.error ?? "Terjadi kesalahan"}\n\n<i>Kredit tidak dikurangi.</i>`,
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    setUserState(telegramId, { lastVideoFileUrl: null, lastVideoFileId: null, pendingAction: null, menuMode: null });

    const caption =
      `${result.message ?? "✅ Teks ditempel!"}\n` +
      `<i>-${cost} kredit | Sisa: ${deducted.remaining} kredit</i>\n\n` +
      `📤 <i>Kirim video baru untuk edit lagi.</i>`;

    await sendEditResult(ctx, result.outputUrl, true, caption);
  } catch (err: any) {
    logger.error({ err }, "Manual subtitle error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\n<i>Kredit tidak dikurangi.</i>`,
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
  }
}

// ─── Watermark Removal ────────────────────────────────────────────────────────
async function runWatermarkRemoval(
  ctx: any,
  telegramId: number,
  videoUrl: string,
  position: WatermarkPosition,
  size: WatermarkSize
): Promise<void> {
  const cost = VIDEO_EDIT_COST;
  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
    return;
  }

  const posLabel: Record<WatermarkPosition, string> = {
    top_left: "Kiri Atas ↖️", top_right: "Kanan Atas ↗️",
    bottom_left: "Kiri Bawah ↙️", bottom_right: "Kanan Bawah ↘️",
    center: "Tengah 🎯",
  };

  await ctx.reply(
    `🗑️ <b>Menghapus watermark...</b>\n\n` +
    `📍 Posisi: <b>${posLabel[position]}</b>\n` +
    `📐 Ukuran: <b>${size.toUpperCase()}</b>\n\n` +
    `<i>Memproses interpolasi area... (10–40 detik)</i>`,
    { parse_mode: "HTML" }
  );
  await ctx.replyWithChatAction("upload_video");

  try {
    const result = await videoRemoveWatermark(videoUrl, position, size);

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ Gagal: ${result.error ?? "Terjadi kesalahan"}\n\n<i>Kredit tidak dikurangi.</i>`,
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    setUserState(telegramId, { lastVideoFileUrl: null, lastVideoFileId: null, pendingAction: null, menuMode: null });

    const caption =
      `${result.message ?? "✅ Watermark dihapus!"}\n` +
      `<i>-${cost} kredit | Sisa: ${deducted.remaining} kredit</i>\n\n` +
      `📤 <i>Kirim video baru untuk edit lagi.</i>`;

    await sendEditResult(ctx, result.outputUrl, true, caption);
  } catch (err: any) {
    logger.error({ err }, "Watermark removal error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\n<i>Kredit tidak dikurangi.</i>`,
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
  }
}

// ─── Bot factory ──────────────────────────────────────────────────────────────
export function createBot(token: string): Bot {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN harus diset.");
  const bot = new Bot(token);

  // ── Commands ────────────────────────────────────────────────────────────────
  bot.command("start",   (ctx) => handleStart(ctx));
  bot.command("menu",    async (ctx) => ctx.reply("Pilih layanan:", { reply_markup: mainInlineKeyboard() }));
  bot.command("akun",    (ctx) => handleAkunInfo(ctx));
  bot.command("kredit",  (ctx) => handleCreditInfo(ctx));
  bot.command("topup",   (ctx) => handleTopUp(ctx));

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "✂️ <b>EditAI — Studio Edit Video Telegram</b>\n\n" +
      "🎨 <b>Perbaiki Video</b>\n" +
      "  ✨ Standar · 💎 Pro · 🌈 HDR\n\n" +
      "📺 <b>Resolusi &amp; Rasio</b>\n" +
      "  Original/HD/FHD/4K + 9:16/1:1/16:9\n\n" +
      "📝 <b>Subtitle</b>\n" +
      "  🎙️ Auto (AssemblyAI) — Classic/TikTok/CapCut\n" +
      "  ✏️ Teks Manual — Bold/Yellow/Neon/Minimal/Cinema\n\n" +
      "🗑️ <b>Hapus Watermark</b>\n" +
      "  5 posisi preset + 3 ukuran (S/M/L)\n\n" +
      `💳 Semua fitur = <b>${VIDEO_EDIT_COST} kredit</b>\n` +
      "<i>Kredit dipotong HANYA jika berhasil. Durasi maks 60 detik.</i>\n\n" +
      "/kredit — cek saldo\n/topup — isi kredit\n/reset — reset state",
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
  });

  bot.command("premium", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    if (args.length > 0 && isAdmin(ctx.from?.id ?? 0)) await handleAdminApprove(ctx, args);
    else await handleTopUp(ctx);
  });

  bot.command("users",        (ctx) => handleAdminUsers(ctx));
  bot.command("stats",        (ctx) => handleAdminStats(ctx));
  bot.command("teststatus",   (ctx) => handleTestStatus(ctx));
  bot.command("broadcast",    async (ctx) => handleBroadcast(ctx, ctx.match?.toString().trim() ?? ""));
  bot.command("ban",          async (ctx) => handleBan(ctx, ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [], true));
  bot.command("unban",        async (ctx) => handleBan(ctx, ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [], false));
  bot.command("addcredit",    async (ctx) => handleAddQuota(ctx, ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? []));
  bot.command("removecredit", async (ctx) => handleRemoveQuota(ctx, ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? []));

  bot.command("reset", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    await clearHistory(telegramId);
    clearPending(telegramId);
    setUserState(telegramId, { menuMode: null, lastVideoFileUrl: null });
    await ctx.reply("✅ State direset! Pilih layanan:", { reply_markup: mainInlineKeyboard() });
  });

  // ── Callback Query ────────────────────────────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data       = ctx.callbackQuery.data;
    const telegramId = ctx.from?.id;
    if (!telegramId) { await ctx.answerCallbackQuery(); return; }

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.answerCallbackQuery("❌ Akun diblokir."); return; }
    await ctx.answerCallbackQuery();

    const state = getUserState(telegramId);

    // ── Navigasi ──────────────────────────────────────────────────────────────
    if (data === "menu:back") {
      clearPending(telegramId);
      await ctx.reply("🎬 Pilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    // ─── 🎨 PERBAIKI VIDEO ─────────────────────────────────────────────────────
    if (data === "menu:perbaiki") {
      await ctx.reply(
        "🎨 <b>Perbaiki Video</b>\n\n" +
        "✨ <b>Standar</b> — denoise + sharpen + warna hidup (cepat)\n" +
        "💎 <b>Pro</b> — kualitas maksimal, detil tajam, warna kaya\n" +
        "🌈 <b>HDR</b> — simulasi HDR, kontras dramatis, premium\n\n" +
        "<i>Pilih mode:</i>",
        { parse_mode: "HTML", reply_markup: perbaikiKeyboard() }
      );
      return;
    }

    if (data === "perbaiki:standard" || data === "perbaiki:pro" || data === "perbaiki:hdr") {
      const actionMap: Record<string, EditAction> = {
        "perbaiki:standard": "video_enhance_standard",
        "perbaiki:pro":      "video_enhance_pro",
        "perbaiki:hdr":      "video_enhance_hdr",
      };
      const action = actionMap[data];
      const labelMap: Record<string, string> = {
        "perbaiki:standard": "✨ Standar", "perbaiki:pro": "💎 Pro", "perbaiki:hdr": "🌈 HDR"
      };
      if (state.lastVideoFileUrl) {
        setUserState(telegramId, { menuMode: null });
        await runEditAction(ctx, telegramId, action, state.lastVideoFileUrl, "video");
      } else {
        setUserState(telegramId, { pendingAction: action });
        await ctx.reply(
          `🎨 <b>Perbaiki Video — ${labelMap[data]}</b>\n\nKirim videomu, saya proses otomatis.\n<i>(Maks 60 detik)</i>`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    // ─── 📺 RESOLUSI & RASIO ───────────────────────────────────────────────────
    if (data === "menu:resolusi_rasio") {
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: "video_resolution_ratio", menuMode: "resolusi" });
        await ctx.reply(
          "📺 <b>Resolusi &amp; Rasio</b>\n\nKirim videomu dulu, lalu pilih resolusi dan rasio.",
          { parse_mode: "HTML" }
        );
        return;
      }
      setUserState(telegramId, { menuMode: "resolusi", pendingResolution: null });
      await ctx.reply(
        "📺 <b>Langkah 1 — Pilih Resolusi</b>\n\n" +
        "📱 <b>Original</b> — resolusi asli video\n" +
        "🎥 <b>HD 720p</b> — 1280×720\n" +
        "✨ <b>Full HD</b> — 1920×1080\n" +
        "👑 <b>4K</b> — 3840×2160",
        { parse_mode: "HTML", reply_markup: resolusiKeyboard() }
      );
      return;
    }

    if (data.startsWith("resolusi:")) {
      const resolution = data.replace("resolusi:", "") as "original" | "hd" | "fhd" | "4k";
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: "video_resolution_ratio", pendingResolution: resolution, menuMode: "rasio" });
        await ctx.reply("📺 Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      setUserState(telegramId, { pendingResolution: resolution, menuMode: "rasio" });
      const resLabel: Record<string, string> = { original: "Original", hd: "HD 720p", fhd: "Full HD 1080p", "4k": "4K 2160p" };
      await ctx.reply(
        `📺 <b>Resolusi: ${resLabel[resolution]}</b>\n\n<b>Langkah 2 — Pilih Rasio</b>\n\n` +
        "📱 <b>9:16</b> — TikTok/Reels/Shorts\n" +
        "🖼️ <b>1:1</b> — Feed Instagram\n" +
        "🎬 <b>16:9</b> — YouTube/Landscape\n" +
        "🔄 <b>Pertahankan</b> — tidak ubah rasio",
        { parse_mode: "HTML", reply_markup: rasioKeyboard() }
      );
      return;
    }

    if (data.startsWith("rasio:")) {
      const ratio = data.replace("rasio:", "") as "9_16" | "1_1" | "16_9" | "keep";
      if (!state.lastVideoFileUrl) {
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      const resolution = getUserState(telegramId).pendingResolution ?? "original";
      setUserState(telegramId, { menuMode: null, pendingResolution: null });
      await runEditAction(ctx, telegramId, "video_resolution_ratio", state.lastVideoFileUrl, "video", { resolution, ratio });
      return;
    }

    // ─── 📝 SUBTITLE ───────────────────────────────────────────────────────────
    if (data === "menu:subtitle") {
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: "video_auto_subtitle", menuMode: "subtitle_main" });
        await ctx.reply(
          "📝 <b>Subtitle</b>\n\nKirim videomu dulu, lalu pilih mode subtitle.",
          { parse_mode: "HTML" }
        );
        return;
      }
      setUserState(telegramId, { menuMode: "subtitle_main" });
      await ctx.reply(
        "📝 <b>Subtitle</b>\n\n" +
        "🎙️ <b>Otomatis</b> — transkripsi AI dari suara video (AssemblyAI)\n" +
        "✏️ <b>Teks Manual</b> — ketik teks sendiri dengan gaya keren\n\n" +
        "<i>Pilih mode:</i>",
        { parse_mode: "HTML", reply_markup: subtitleMainKeyboard() }
      );
      return;
    }

    // ─── Mode subtitle: Auto ────────────────────────────────────────────────
    if (data === "subtitle_mode:auto" || data === "menu:subtitle_auto_style") {
      setUserState(telegramId, { menuMode: "subtitle_style" });
      await ctx.reply(
        "🎙️ <b>Subtitle Otomatis — Pilih Gaya</b>\n\n" +
        "📝 <b>Classic</b> — bersih, background hitam, shadow\n" +
        "📱 <b>TikTok Style</b> — besar, bold, kontras tinggi\n" +
        "🎬 <b>CapCut Style</b> — elegan, semi-transparan\n\n" +
        "<i>Pilih gaya subtitle:</i>",
        { parse_mode: "HTML", reply_markup: subtitleStyleKeyboard() }
      );
      return;
    }

    if (data.startsWith("subtitle_style:")) {
      const style = data.replace("subtitle_style:", "") as SubtitleStyle;
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { subtitleStyle: style, pendingAction: "video_auto_subtitle", menuMode: "subtitle_pos" });
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      setUserState(telegramId, { subtitleStyle: style, menuMode: "subtitle_pos" });
      const styleLabel: Record<SubtitleStyle, string> = { classic: "Classic 📝", tiktok: "TikTok Style 📱", capcut: "CapCut Style 🎬" };
      await ctx.reply(
        `📝 <b>Gaya: ${styleLabel[style]}</b>\n\n<b>Pilih posisi subtitle:</b>\n\n` +
        "⬆️ <b>Atas</b> | ↕️ <b>Tengah</b> | ⬇️ <b>Bawah</b> (standar)\n" +
        "🎯 <b>Kustom</b> — masukkan angka 0–100",
        { parse_mode: "HTML", reply_markup: subtitlePosKeyboard() }
      );
      return;
    }

    if (data.startsWith("subtitle_pos:")) {
      const pos = data.replace("subtitle_pos:", "") as "top" | "middle" | "bottom" | "custom";
      if (!state.lastVideoFileUrl) {
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      if (pos === "custom") {
        setUserState(telegramId, { awaitingCustomPosition: true, menuMode: null });
        await ctx.reply(
          "🎯 <b>Posisi Kustom</b>\n\nKetik angka <b>0–100</b>:\n\n" +
          "• <code>5</code> = sangat atas\n• <code>50</code> = tengah\n• <code>90</code> = bawah\n\n" +
          "<i>Contoh: ketik</i> <code>85</code>",
          { parse_mode: "HTML" }
        );
        return;
      }
      setUserState(telegramId, { subtitlePosition: pos, menuMode: null });
      await runSubtitleProcess(ctx, telegramId, state.lastVideoFileUrl, getUserState(telegramId).subtitleStyle, pos, 85);
      return;
    }

    // ─── Mode subtitle: Manual ──────────────────────────────────────────────
    if (data === "subtitle_mode:manual" || data === "menu:subtitle_manual_style") {
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: "video_manual_subtitle", menuMode: "manual_sub_input" });
        await ctx.reply("✏️ Kirim videomu dulu, lalu ketik teksnya.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      setUserState(telegramId, { menuMode: "manual_sub_style" });
      await ctx.reply(
        "✏️ <b>Teks Manual — Pilih Gaya</b>\n\n" +
        "✨ <b>Bold White</b> — putih, outline hitam tebal\n" +
        "💛 <b>TikTok Yellow</b> — putih + border emas, box tebal\n" +
        "🔥 <b>Neon Orange</b> — oranye menyala, glow effect\n" +
        "💎 <b>CapCut Minimal</b> — putih bersih, shadow halus\n" +
        "🎬 <b>Cinematic Bar</b> — bar hitam penuh + teks putih\n\n" +
        "<i>Pilih gaya teks:</i>",
        { parse_mode: "HTML", reply_markup: manualSubStyleKeyboard() }
      );
      return;
    }

    if (data.startsWith("mansub_style:")) {
      const style = data.replace("mansub_style:", "") as ManualSubtitleStyle;
      setUserState(telegramId, { manualSubtitleStyle: style, menuMode: "manual_sub_pos" });
      const styleLabel: Record<ManualSubtitleStyle, string> = {
        bold_white: "Bold White ✨", tiktok_yellow: "TikTok Yellow 💛",
        neon_orange: "Neon Orange 🔥", capcut_minimal: "CapCut Minimal 💎", cinematic: "Cinematic Bar 🎬",
      };
      await ctx.reply(
        `✏️ <b>Gaya: ${styleLabel[style]}</b>\n\n<b>Pilih posisi teks:</b>`,
        { parse_mode: "HTML", reply_markup: manualSubPosKeyboard() }
      );
      return;
    }

    if (data.startsWith("mansub_pos:")) {
      const pos = data.replace("mansub_pos:", "") as "top" | "middle" | "bottom";
      const currentState = getUserState(telegramId);
      setUserState(telegramId, { manualSubtitlePosition: pos, menuMode: "manual_sub_input", awaitingManualSubtitleText: true });
      const posLabel = { top: "Atas ⬆️", middle: "Tengah ↕️", bottom: "Bawah ⬇️" }[pos];
      await ctx.reply(
        `✏️ <b>Posisi: ${posLabel}</b>\n\n` +
        `💬 <b>Ketik teks yang ingin ditempel ke video:</b>\n\n` +
        `<i>Untuk multi-baris, gunakan Enter baru atau \\n\nContoh:</i>\n<code>Nama Channel</code>\n<code>@username</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ─── 🗑️ HAPUS WATERMARK ────────────────────────────────────────────────────
    if (data === "menu:watermark") {
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: "video_remove_watermark", menuMode: "watermark_pos" });
        await ctx.reply(
          "🗑️ <b>Hapus Watermark</b>\n\nKirim videomu dulu, lalu pilih posisi watermark.",
          { parse_mode: "HTML" }
        );
        return;
      }
      setUserState(telegramId, { menuMode: "watermark_pos" });
      await ctx.reply(
        "🗑️ <b>Hapus Watermark</b>\n\n" +
        "Pilih <b>posisi watermark</b> di video:\n\n" +
        "↖️ Kiri Atas — ↗️ Kanan Atas\n" +
        "↙️ Kiri Bawah — ↘️ Kanan Bawah\n" +
        "🎯 Tengah\n\n" +
        "<i>Bot akan merekonstruksi area tersebut menggunakan interpolasi piksel.</i>",
        { parse_mode: "HTML", reply_markup: watermarkPosKeyboard() }
      );
      return;
    }

    if (data.startsWith("wm_pos:")) {
      const pos = data.replace("wm_pos:", "") as WatermarkPosition;
      if (!state.lastVideoFileUrl) {
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      setUserState(telegramId, { watermarkPosition: pos, menuMode: "watermark_size" });
      const posLabel: Record<WatermarkPosition, string> = {
        top_left: "Kiri Atas ↖️", top_right: "Kanan Atas ↗️",
        bottom_left: "Kiri Bawah ↙️", bottom_right: "Kanan Bawah ↘️",
        center: "Tengah 🎯",
      };
      await ctx.reply(
        `🗑️ <b>Posisi: ${posLabel[pos]}</b>\n\n<b>Pilih ukuran watermark:</b>\n\n` +
        "S — Kecil (≈10% lebar video)\n" +
        "M — Sedang (≈20% lebar video) [rekomendasi]\n" +
        "L — Besar (≈30% lebar video)\n\n" +
        "<i>Jika tidak yakin, pilih M.</i>",
        { parse_mode: "HTML", reply_markup: watermarkSizeKeyboard() }
      );
      return;
    }

    if (data.startsWith("wm_size:")) {
      const size = data.replace("wm_size:", "") as WatermarkSize;
      const currentState = getUserState(telegramId);
      if (!currentState.lastVideoFileUrl) {
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      const wmPos = currentState.watermarkPosition ?? "top_right";
      setUserState(telegramId, { watermarkSize: size, menuMode: null, watermarkPosition: null });
      await runWatermarkRemoval(ctx, telegramId, currentState.lastVideoFileUrl, wmPos, size);
      return;
    }

    // ─── Top Up ────────────────────────────────────────────────────────────────
    if (data === "menu:topup") {
      await handleTopUp(ctx as any);
      return;
    }

    if (data.startsWith("topup_tier:")) {
      const tierKey = data.replace("topup_tier:", "") as TopupTierKey;
      if (tierKey === "starter" || tierKey === "value") await handleTopUpTier(ctx as any, tierKey);
      return;
    }
  });

  // ── Foto ──────────────────────────────────────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun diblokir."); return; }
    const state = getUserState(telegramId);
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }
    await ctx.reply("📸 Bot ini khusus edit video. Kirim video untuk mulai.", { reply_markup: mainInlineKeyboard() });
  });

  // ── Video ──────────────────────────────────────────────────────────────────
  bot.on("message:video", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun diblokir."); return; }

    const vid = ctx.message.video;
    if (vid.file_size && vid.file_size > 50 * 1024 * 1024) {
      await ctx.reply(
        "❌ <b>File terlalu besar</b> (maks ~50MB).\nKompres atau kirim video yang lebih pendek.",
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    await ctx.replyWithChatAction("typing");

    const state   = getUserState(telegramId);
    const file    = await ctx.api.getFile(vid.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    setUserState(telegramId, { lastVideoFileId: vid.file_id, lastVideoFileUrl: fileUrl });

    if (state.pendingAction) {
      const pendingAct = state.pendingAction;

      if (["video_enhance_standard", "video_enhance_pro", "video_enhance_hdr"].includes(pendingAct)) {
        setUserState(telegramId, { pendingAction: null });
        await runEditAction(ctx, telegramId, pendingAct, fileUrl, "video");
        return;
      }

      if (pendingAct === "video_resolution_ratio") {
        const s = getUserState(telegramId);
        if (s.pendingResolution && s.menuMode === "rasio") {
          setUserState(telegramId, { pendingAction: null });
          const resLabel: Record<string, string> = { original: "Original", hd: "HD 720p", fhd: "Full HD 1080p", "4k": "4K 2160p" };
          await ctx.reply(
            `📺 <b>Resolusi: ${resLabel[s.pendingResolution]}</b>\n\n<b>Pilih rasio:</b>`,
            { parse_mode: "HTML", reply_markup: rasioKeyboard() }
          );
        } else {
          setUserState(telegramId, { pendingAction: null, menuMode: "resolusi" });
          await ctx.reply("📺 <b>Pilih resolusi:</b>", { parse_mode: "HTML", reply_markup: resolusiKeyboard() });
        }
        return;
      }

      if (pendingAct === "video_remove_watermark") {
        setUserState(telegramId, { pendingAction: null, menuMode: "watermark_pos" });
        await ctx.reply(
          "🗑️ <b>Pilih posisi watermark:</b>",
          { parse_mode: "HTML", reply_markup: watermarkPosKeyboard() }
        );
        return;
      }

      if (pendingAct === "video_auto_subtitle" || pendingAct === "video_manual_subtitle") {
        const s = getUserState(telegramId);
        if (s.menuMode === "subtitle_pos") {
          setUserState(telegramId, { pendingAction: null });
          await ctx.reply("📝 <b>Pilih posisi subtitle:</b>", { parse_mode: "HTML", reply_markup: subtitlePosKeyboard() });
        } else if (s.menuMode === "manual_sub_pos") {
          setUserState(telegramId, { pendingAction: null });
          await ctx.reply("✏️ <b>Pilih posisi teks:</b>", { parse_mode: "HTML", reply_markup: manualSubPosKeyboard() });
        } else if (s.menuMode === "manual_sub_style" || s.menuMode === "manual_sub_input") {
          setUserState(telegramId, { pendingAction: null });
          await ctx.reply("✏️ <b>Pilih gaya teks manual:</b>", { parse_mode: "HTML", reply_markup: manualSubStyleKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: null, menuMode: "subtitle_main" });
          await ctx.reply("📝 <b>Pilih mode subtitle:</b>", { parse_mode: "HTML", reply_markup: subtitleMainKeyboard() });
        }
        return;
      }

      setUserState(telegramId, { pendingAction: null });
    }

    // Jika dalam mode menu, tampilkan sub-menu yang relevan
    const currentMenuMode = getUserState(telegramId).menuMode;
    if (currentMenuMode === "resolusi") {
      await ctx.reply("📺 <b>Pilih resolusi:</b>", { parse_mode: "HTML", reply_markup: resolusiKeyboard() });
      return;
    }
    if (currentMenuMode === "watermark_pos") {
      await ctx.reply("🗑️ <b>Pilih posisi watermark:</b>", { parse_mode: "HTML", reply_markup: watermarkPosKeyboard() });
      return;
    }
    if (currentMenuMode === "subtitle_main" || currentMenuMode === "subtitle_style") {
      await ctx.reply("📝 <b>Pilih mode subtitle:</b>", { parse_mode: "HTML", reply_markup: subtitleMainKeyboard() });
      return;
    }
    if (currentMenuMode === "manual_sub_style") {
      await ctx.reply("✏️ <b>Pilih gaya teks:</b>", { parse_mode: "HTML", reply_markup: manualSubStyleKeyboard() });
      return;
    }

    // Cek caption untuk langsung proses via AI
    const caption = ctx.message.caption?.trim() ?? "";
    if (caption) {
      const agentResp = await runAgent(telegramId, caption);
      if (agentResp.action) {
        if (agentResp.action === "video_auto_subtitle") {
          setUserState(telegramId, { menuMode: "subtitle_style" });
          await ctx.reply("📝 <b>Pilih gaya subtitle otomatis:</b>", { parse_mode: "HTML", reply_markup: subtitleStyleKeyboard() });
          return;
        }
        if (agentResp.action === "video_manual_subtitle") {
          setUserState(telegramId, { menuMode: "manual_sub_style" });
          await ctx.reply("✏️ <b>Pilih gaya teks manual:</b>", { parse_mode: "HTML", reply_markup: manualSubStyleKeyboard() });
          return;
        }
        if (agentResp.action === "video_resolution_ratio") {
          setUserState(telegramId, { menuMode: "resolusi" });
          await ctx.reply("📺 <b>Pilih resolusi:</b>", { parse_mode: "HTML", reply_markup: resolusiKeyboard() });
          return;
        }
        if (agentResp.action === "video_remove_watermark") {
          setUserState(telegramId, { menuMode: "watermark_pos" });
          await ctx.reply("🗑️ <b>Pilih posisi watermark:</b>", { parse_mode: "HTML", reply_markup: watermarkPosKeyboard() });
          return;
        }
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "video");
        return;
      }
      await ctx.reply(agentResp.message + "\n\n🎬 Pilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    await ctx.reply(
      "🎬 <b>Video diterima!</b>\n\nPilih layanan edit:",
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
  });

  // ── Teks ──────────────────────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun diblokir."); return; }

    const state   = getUserState(telegramId);
    const trimmed = text.trim();

    if (state.awaitingPaymentProof) {
      await ctx.reply("Kirim foto/screenshot bukti pembayaran ya.", { reply_markup: mainInlineKeyboard() });
      return;
    }

    // ── Input posisi kustom subtitle ─────────────────────────────────────────
    if (state.awaitingCustomPosition) {
      const num = parseInt(trimmed);
      if (isNaN(num) || num < 0 || num > 100) {
        await ctx.reply("❌ Angka tidak valid. Ketik angka <b>0–100</b>.\nContoh: <code>85</code>", { parse_mode: "HTML" });
        return;
      }
      const videoUrl = state.lastVideoFileUrl;
      if (!videoUrl) {
        setUserState(telegramId, { awaitingCustomPosition: false });
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      setUserState(telegramId, { awaitingCustomPosition: false, subtitleCustomY: num, subtitlePosition: "custom" });
      await runSubtitleProcess(ctx, telegramId, videoUrl, getUserState(telegramId).subtitleStyle, "custom", num);
      return;
    }

    // ── Input teks manual subtitle ───────────────────────────────────────────
    if (state.awaitingManualSubtitleText) {
      const videoUrl = state.lastVideoFileUrl;
      if (!videoUrl) {
        setUserState(telegramId, { awaitingManualSubtitleText: false });
        await ctx.reply("Video sudah tidak tersedia. Kirim ulang videonya.", { reply_markup: mainInlineKeyboard() });
        return;
      }
      setUserState(telegramId, {
        awaitingManualSubtitleText: false,
        pendingManualSubtitleText: trimmed,
        menuMode: null,
      });
      await runManualSubtitleProcess(
        ctx, telegramId, videoUrl, trimmed,
        getUserState(telegramId).manualSubtitleStyle,
        getUserState(telegramId).manualSubtitlePosition
      );
      return;
    }

    // ── Chat AI ──────────────────────────────────────────────────────────────
    await ctx.replyWithChatAction("typing");
    const agentResp = await runAgent(telegramId, trimmed);

    if (agentResp.action) {
      const s = getUserState(telegramId);

      if (agentResp.action === "video_auto_subtitle") {
        if (s.lastVideoFileUrl) {
          setUserState(telegramId, { menuMode: "subtitle_style" });
          await ctx.reply(agentResp.message + "\n\n📝 Pilih gaya subtitle:", { reply_markup: subtitleStyleKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: "video_auto_subtitle", menuMode: "subtitle_style" });
          await ctx.reply(agentResp.message + "\n\nKirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        }
        return;
      }

      if (agentResp.action === "video_manual_subtitle") {
        if (s.lastVideoFileUrl) {
          setUserState(telegramId, { menuMode: "manual_sub_style" });
          await ctx.reply(agentResp.message + "\n\n✏️ Pilih gaya teks:", { reply_markup: manualSubStyleKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: "video_manual_subtitle", menuMode: "manual_sub_style" });
          await ctx.reply(agentResp.message + "\n\nKirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        }
        return;
      }

      if (agentResp.action === "video_resolution_ratio") {
        if (s.lastVideoFileUrl) {
          setUserState(telegramId, { menuMode: "resolusi" });
          await ctx.reply(agentResp.message + "\n\n📺 Pilih resolusi:", { reply_markup: resolusiKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: "video_resolution_ratio", menuMode: "resolusi" });
          await ctx.reply(agentResp.message + "\n\nKirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        }
        return;
      }

      if (agentResp.action === "video_remove_watermark") {
        if (s.lastVideoFileUrl) {
          setUserState(telegramId, { menuMode: "watermark_pos" });
          await ctx.reply(agentResp.message + "\n\n🗑️ Pilih posisi watermark:", { reply_markup: watermarkPosKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: "video_remove_watermark", menuMode: "watermark_pos" });
          await ctx.reply(agentResp.message + "\n\nKirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        }
        return;
      }

      if (s.lastVideoFileUrl) {
        await runEditAction(ctx, telegramId, agentResp.action, s.lastVideoFileUrl, "video", agentResp.extraParams);
        return;
      }

      setUserState(telegramId, { pendingAction: agentResp.action });
      await ctx.reply(`${agentResp.message}\n\nKirim videomu untuk diproses.`, { reply_markup: mainInlineKeyboard() });
      return;
    }

    await ctx.reply(agentResp.message, { reply_markup: mainInlineKeyboard() });
  });

  // ── Media lain ────────────────────────────────────────────────────────────
  bot.on("message:voice",    async (ctx) => ctx.reply("Pesan suara belum didukung. Kirim video.", { reply_markup: mainInlineKeyboard() }));
  bot.on("message:sticker",  async (ctx) => ctx.reply("🎬 Pilih layanan video:", { reply_markup: mainInlineKeyboard() }));
  bot.on("message:document", async (ctx) => {
    const telegramId = ctx.from?.id ?? 0;
    const state = getUserState(telegramId);
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }
    await ctx.reply("Kirim video langsung (bukan sebagai file) ya.", { reply_markup: mainInlineKeyboard() });
  });

  // ── Error global ──────────────────────────────────────────────────────────
  bot.catch((err) => {
    logger.error({ err: err.error }, "Bot error");
    if (err.error instanceof GrammyError) logger.error({ desc: err.error.description }, "GrammyError");
    else if (err.error instanceof HttpError) logger.error({ err: err.error }, "HttpError");
    err.ctx.reply("Terjadi kesalahan. Ketik /reset dan coba lagi.", { reply_markup: mainInlineKeyboard() }).catch(() => {});
  });

  return bot;
}
