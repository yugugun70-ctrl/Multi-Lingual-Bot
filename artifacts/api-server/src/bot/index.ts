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
  subtitleStyleKeyboard,
  subtitlePosKeyboard,
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
import type { SubtitleStyle } from "./state";
import { executeEditAction, videoAutoSubtitle } from "./tools";
import { transcribeVideo, getVideoInfo } from "../lib/transcribe";
import { bufferToTempFile } from "../lib/image-processor";
import type { EditAction } from "./state";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function sendEditResult(ctx: any, outputUrl: string, isVideo: boolean, caption: string): Promise<void> {
  const kb = mainInlineKeyboard();
  if (isVideo) {
    if (outputUrl.startsWith("data:video")) {
      const buf = Buffer.from(outputUrl.split(",")[1], "base64");
      await ctx.replyWithVideo(new InputFile(buf, "editai_video.mp4"), { caption, supports_streaming: true, reply_markup: kb });
    } else {
      await ctx.replyWithVideo(outputUrl, { caption, reply_markup: kb });
    }
    return;
  }
  if (outputUrl.startsWith("data:image")) {
    const ext = outputUrl.startsWith("data:image/png") ? "png" : "jpg";
    const buf = Buffer.from(outputUrl.split(",")[1], "base64");
    await ctx.replyWithPhoto(new InputFile(buf, `editai.${ext}`), { caption, reply_markup: kb });
  } else {
    await ctx.replyWithPhoto(outputUrl, { caption, reply_markup: kb });
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

  await ctx.reply("⏳ Sedang diproses... (10–120 detik)\nKredit dipotong hanya jika berhasil.");
  await ctx.replyWithChatAction("upload_video");

  try {
    const result = await executeEditAction(action, fileUrl, fileType, extraParams);

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ Gagal: ${result.error ?? "Terjadi kesalahan"}\n\nKredit tidak dikurangi.`,
        { reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    setUserState(telegramId, { lastVideoFileUrl: null, lastVideoFileId: null, pendingAction: null, menuMode: null });

    const caption =
      `${result.message ?? "Selesai!"}\n` +
      (cost > 0 ? `-${cost} kredit | Sisa: ${deducted.remaining} kredit\n` : "") +
      `\n✅ Kirim video baru untuk edit lagi.`;

    await sendEditResult(ctx, result.outputUrl, result.isVideo ?? true, caption);
  } catch (err: any) {
    logger.error({ err }, "Edit execution error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\nKredit tidak dikurangi.`,
      { reply_markup: mainInlineKeyboard() }
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
  const cost = getCreditCost("video_auto_subtitle" as EditAction);
  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
    return;
  }

  if (getUserState(telegramId).isTranscribing) {
    await ctx.reply("⏳ Transkripsi sebelumnya sedang berjalan...");
    return;
  }

  const styleLabel = { classic: "Classic 📝", tiktok: "TikTok 📱", capcut: "CapCut 🎬" }[style];
  const posLabel   = { top: "Atas ⬆️", middle: "Tengah ↕️", bottom: "Bawah ⬇️", custom: `Kustom ${customYPercent}% 🎯` }[position];

  setUserState(telegramId, { isTranscribing: true });
  await ctx.reply(
    `🎙️ <b>Membuat subtitle otomatis...</b>\n\n` +
    `🎨 Gaya: <b>${styleLabel}</b>\n` +
    `📍 Posisi: <b>${posLabel}</b>\n\n` +
    `<i>Mengekstrak audio → transkripsi → tempel subtitle...\n(15–60 detik)</i>`,
    { parse_mode: "HTML" }
  );
  await ctx.replyWithChatAction("upload_video");

  try {
    const buf     = await downloadBuffer(videoUrl);
    const tmpPath = await bufferToTempFile(buf, "mp4");

    const [transcript, videoInfo] = await Promise.all([
      transcribeVideo(tmpPath),
      getVideoInfo(tmpPath),
    ]);

    await import("node:fs/promises").then(m => m.unlink(tmpPath)).catch(() => {});

    if (!transcript.success || !transcript.segments || transcript.segments.length === 0) {
      setUserState(telegramId, { isTranscribing: false });
      await ctx.reply(
        `❌ Tidak bisa mendeteksi suara.\n\n${transcript.error ?? "Pastikan video memiliki audio yang jelas."}\n\n` +
        `<i>Tips: Pastikan audio tidak terlalu berisik dan suara jelas terdengar.</i>`,
        { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    logger.info({
      provider: transcript.provider,
      segs: transcript.segments.length,
      style,
      position,
      videoInfo,
    }, "Transkripsi selesai, menempel subtitle...");

    await ctx.reply(
      `✅ <b>${transcript.segments.length} segmen terdeteksi</b> (${transcript.provider ?? "AI"})\n` +
      `⏳ Menempel subtitle ke video...`,
      { parse_mode: "HTML" }
    );

    const result = await videoAutoSubtitle(videoUrl, transcript.segments, position, style, customYPercent);

    setUserState(telegramId, { isTranscribing: false });

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ Gagal menempel subtitle: ${result.error ?? "Terjadi kesalahan"}\n\nKredit tidak dikurangi.`,
        { reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    setUserState(telegramId, { lastVideoFileUrl: null, lastVideoFileId: null, pendingAction: null, menuMode: null });

    const caption =
      `${result.message ?? "Subtitle selesai!"}\n` +
      (cost > 0 ? `-${cost} kredit | Sisa: ${deducted.remaining} kredit\n` : "") +
      `\n✅ Kirim video baru untuk edit lagi.`;

    await sendEditResult(ctx, result.outputUrl, true, caption);

  } catch (err: any) {
    setUserState(telegramId, { isTranscribing: false });
    logger.error({ err }, "Subtitle process error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\nKredit tidak dikurangi.`,
      { reply_markup: mainInlineKeyboard() }
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
      "✂️ <b>EditAI — Bot Edit Video</b>\n\n" +
      "Kirim video, lalu pilih layanan:\n\n" +
      "🎨 <b>Perbaiki Video</b>\n" +
      "  ✨ Standar — jernih, tajam, warna hidup\n" +
      "  💎 Pro — kualitas tinggi, detail maksimal\n" +
      "  🌈 HDR — warna dramatis, kontras premium\n\n" +
      "📺 <b>Resolusi &amp; Rasio</b>\n" +
      "  📱 Original · 🎥 HD · ✨ Full HD · 👑 4K\n" +
      "  📱 9:16 · 🖼️ 1:1 · 🎬 16:9\n\n" +
      "📝 <b>Subtitle Otomatis</b>\n" +
      "  🎙️ Transkripsi AI dari suara video\n" +
      "  📝 Classic · 📱 TikTok · 🎬 CapCut\n\n" +
      `💳 Semua fitur = <b>${VIDEO_EDIT_COST} kredit</b>\n` +
      "Kredit dipotong HANYA jika berhasil.\n" +
      "<i>Durasi video maks 60 detik</i>\n\n" +
      "/kredit — cek saldo\n/topup — top up kredit\n/reset — reset percakapan",
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
    await ctx.reply("✅ Reset! Pilih layanan:", { reply_markup: mainInlineKeyboard() });
  });

  // ── Callback Query ────────────────────────────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data       = ctx.callbackQuery.data;
    const telegramId = ctx.from?.id;
    if (!telegramId) { await ctx.answerCallbackQuery(); return; }

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.answerCallbackQuery("Akun kamu diblokir."); return; }
    await ctx.answerCallbackQuery();

    // ── Navigasi kembali ke menu utama ────────────────────────────────────────
    if (data === "menu:back") {
      clearPending(telegramId);
      await ctx.reply("Pilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    // ── Menu Perbaiki Video ───────────────────────────────────────────────────
    if (data === "menu:perbaiki") {
      await ctx.reply(
        "🎨 <b>Perbaiki Video</b>\n\n" +
        "✨ <b>Standar</b> — denoise + sharpen + warna lebih hidup\n" +
        "💎 <b>Pro</b> — kualitas tinggi, super tajam, warna kaya\n" +
        "🌈 <b>HDR</b> — warna dramatis, kontras premium\n\n" +
        "<i>Pilih mode perbaikan:</i>",
        { parse_mode: "HTML", reply_markup: perbaikiKeyboard() }
      );
      return;
    }

    // ── Perbaiki Video Actions ────────────────────────────────────────────────
    if (data === "perbaiki:standard" || data === "perbaiki:pro" || data === "perbaiki:hdr") {
      const actionMap: Record<string, EditAction> = {
        "perbaiki:standard": "video_enhance_standard",
        "perbaiki:pro":      "video_enhance_pro",
        "perbaiki:hdr":      "video_enhance_hdr",
      };
      const action = actionMap[data];
      const state  = getUserState(telegramId);

      if (state.lastVideoFileUrl) {
        setUserState(telegramId, { menuMode: null });
        await runEditAction(ctx, telegramId, action, state.lastVideoFileUrl, "video");
      } else {
        setUserState(telegramId, { pendingAction: action });
        const labelMap: Record<string, string> = {
          "perbaiki:standard": "✨ Standar",
          "perbaiki:pro":      "💎 Pro",
          "perbaiki:hdr":      "🌈 HDR",
        };
        await ctx.reply(
          `🎨 <b>Perbaiki Video — ${labelMap[data]}</b>\n\nKirim videomu, saya proses otomatis.\n<i>(Durasi maks 60 detik)</i>`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    // ── Menu Resolusi & Rasio ─────────────────────────────────────────────────
    if (data === "menu:resolusi_rasio") {
      const state = getUserState(telegramId);
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
        "📺 <b>Resolusi &amp; Rasio</b>\n\n<b>Langkah 1: Pilih resolusi</b>\n\n" +
        "📱 <b>Original</b> — resolusi video asli\n" +
        "🎥 <b>HD 720p</b> — 1280×720\n" +
        "✨ <b>Full HD 1080p</b> — 1920×1080\n" +
        "👑 <b>4K 2160p</b> — 3840×2160\n\n" +
        "<i>Setelah ini, pilih rasio video.</i>",
        { parse_mode: "HTML", reply_markup: resolusiKeyboard() }
      );
      return;
    }

    // ── Pilih Resolusi ────────────────────────────────────────────────────────
    if (data.startsWith("resolusi:")) {
      const resolution = data.replace("resolusi:", "") as "original" | "hd" | "fhd" | "4k";
      const state = getUserState(telegramId);

      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, {
          pendingAction: "video_resolution_ratio",
          pendingResolution: resolution,
          menuMode: "rasio",
        });
        await ctx.reply(
          "📺 Kirim videomu dulu, lalu saya proses.",
          { reply_markup: mainInlineKeyboard() }
        );
        return;
      }

      setUserState(telegramId, { pendingResolution: resolution, menuMode: "rasio" });

      const resLabel: Record<string, string> = {
        original: "Original", hd: "HD 720p", fhd: "Full HD 1080p", "4k": "4K 2160p"
      };
      await ctx.reply(
        `📺 <b>Resolusi: ${resLabel[resolution]}</b>\n\n<b>Langkah 2: Pilih rasio video</b>\n\n` +
        "📱 <b>9:16</b> — TikTok/Reels/Shorts\n" +
        "🖼️ <b>1:1</b> — Feed Instagram/Facebook\n" +
        "🎬 <b>16:9</b> — YouTube/Landscape\n" +
        "🔄 <b>Pertahankan Asli</b> — tidak ubah rasio\n",
        { parse_mode: "HTML", reply_markup: rasioKeyboard() }
      );
      return;
    }

    // ── Pilih Rasio → Proses ──────────────────────────────────────────────────
    if (data.startsWith("rasio:")) {
      const ratio = data.replace("rasio:", "") as "9_16" | "1_1" | "16_9" | "keep";
      const state = getUserState(telegramId);

      if (!state.lastVideoFileUrl) {
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }

      const resolution = state.pendingResolution ?? "original";
      setUserState(telegramId, { menuMode: null, pendingResolution: null });
      await runEditAction(ctx, telegramId, "video_resolution_ratio", state.lastVideoFileUrl, "video", {
        resolution,
        ratio,
      });
      return;
    }

    // ── Menu Subtitle ─────────────────────────────────────────────────────────
    if (data === "menu:subtitle") {
      const state = getUserState(telegramId);
      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: "video_auto_subtitle", menuMode: "subtitle_style" });
        await ctx.reply(
          "📝 <b>Subtitle Otomatis</b>\n\nKirim videomu dulu, lalu pilih gaya subtitle.",
          { parse_mode: "HTML" }
        );
        return;
      }
      setUserState(telegramId, { menuMode: "subtitle_style" });
      await ctx.reply(
        "📝 <b>Subtitle Otomatis</b>\n\n" +
        "📝 <b>Classic</b> — teks bersih dengan background hitam\n" +
        "📱 <b>TikTok Style</b> — teks besar, kontras tinggi\n" +
        "🎬 <b>CapCut Style</b> — teks elegan, semi-transparan\n\n" +
        "<i>Pilih gaya subtitle:</i>",
        { parse_mode: "HTML", reply_markup: subtitleStyleKeyboard() }
      );
      return;
    }

    // ── Pilih Gaya Subtitle ───────────────────────────────────────────────────
    if (data.startsWith("subtitle_style:")) {
      const style = data.replace("subtitle_style:", "") as SubtitleStyle;
      const state = getUserState(telegramId);

      if (!state.lastVideoFileUrl) {
        setUserState(telegramId, { subtitleStyle: style, pendingAction: "video_auto_subtitle", menuMode: "subtitle_pos" });
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }

      setUserState(telegramId, { subtitleStyle: style, menuMode: "subtitle_pos" });
      const styleLabel: Record<SubtitleStyle, string> = { classic: "Classic 📝", tiktok: "TikTok Style 📱", capcut: "CapCut Style 🎬" };
      await ctx.reply(
        `📝 <b>Gaya: ${styleLabel[style]}</b>\n\n<b>Pilih posisi subtitle:</b>\n\n` +
        "⬆️ <b>Atas</b> — bagian atas video\n" +
        "↕️ <b>Tengah</b> — tengah video\n" +
        "⬇️ <b>Bawah</b> — bagian bawah (standar)\n" +
        "🎯 <b>Kustom</b> — masukkan angka 0–100",
        { parse_mode: "HTML", reply_markup: subtitlePosKeyboard() }
      );
      return;
    }

    // ── Pilih Posisi Subtitle → Proses ────────────────────────────────────────
    if (data.startsWith("subtitle_pos:")) {
      const pos   = data.replace("subtitle_pos:", "") as "top" | "middle" | "bottom" | "custom";
      const state = getUserState(telegramId);

      if (!state.lastVideoFileUrl) {
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }

      if (pos === "custom") {
        setUserState(telegramId, { awaitingCustomPosition: true, menuMode: null });
        await ctx.reply(
          "🎯 <b>Posisi Kustom</b>\n\nMasukkan angka <b>0–100</b>:\n\n" +
          "• 0–15 = area atas\n" +
          "• 40–60 = area tengah\n" +
          "• 75–100 = area bawah\n\n" +
          "<i>Contoh ketik:</i> <code>85</code>",
          { parse_mode: "HTML" }
        );
        return;
      }

      setUserState(telegramId, { subtitlePosition: pos, menuMode: null });
      const style = state.subtitleStyle ?? "classic";
      await runSubtitleProcess(ctx, telegramId, state.lastVideoFileUrl, style, pos, 85);
      return;
    }

    // ── Pilihan paket top up ──────────────────────────────────────────────────
    if (data === "menu:topup") {
      await handleTopUp(ctx as any);
      return;
    }

    if (data.startsWith("topup_tier:")) {
      const tierKey = data.replace("topup_tier:", "") as TopupTierKey;
      if (tierKey === "starter" || tierKey === "value") {
        await handleTopUpTier(ctx as any, tierKey);
      }
      return;
    }
  });

  // ── Foto ──────────────────────────────────────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun kamu diblokir."); return; }
    const state = getUserState(telegramId);
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }
    await ctx.reply("📸 Bot ini khusus edit video. Kirim video untuk mulai.", { reply_markup: mainInlineKeyboard() });
  });

  // ── Video ──────────────────────────────────────────────────────────────────
  bot.on("message:video", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun kamu diblokir."); return; }

    const vid = ctx.message.video;
    if (vid.file_size && vid.file_size > 50 * 1024 * 1024) {
      await ctx.reply(
        "❌ File video terlalu besar (maks ~50MB).\n\nKompres dulu atau kirim video yang lebih pendek.",
        { reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    await ctx.replyWithChatAction("typing");

    const state   = getUserState(telegramId);
    const file    = await ctx.api.getFile(vid.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    setUserState(telegramId, { lastVideoFileId: vid.file_id, lastVideoFileUrl: fileUrl });

    // Jika ada pending action, langsung proses
    if (state.pendingAction) {
      const pendingAct = state.pendingAction;

      // Perbaiki Video
      if (pendingAct === "video_enhance_standard" || pendingAct === "video_enhance_pro" || pendingAct === "video_enhance_hdr") {
        setUserState(telegramId, { pendingAction: null });
        await runEditAction(ctx, telegramId, pendingAct, fileUrl, "video");
        return;
      }

      // Resolusi & Rasio — sudah ada resolution di state?
      if (pendingAct === "video_resolution_ratio") {
        const pendingRes = getUserState(telegramId).pendingResolution;
        if (pendingRes && getUserState(telegramId).menuMode === "rasio") {
          // Sudah pilih resolusi, sekarang pilih rasio
          setUserState(telegramId, { pendingAction: null });
          const resLabel: Record<string, string> = {
            original: "Original", hd: "HD 720p", fhd: "Full HD 1080p", "4k": "4K 2160p"
          };
          await ctx.reply(
            `📺 <b>Resolusi: ${resLabel[pendingRes]}</b>\n\n<b>Pilih rasio video:</b>`,
            { parse_mode: "HTML", reply_markup: rasioKeyboard() }
          );
        } else {
          setUserState(telegramId, { pendingAction: null, menuMode: "resolusi" });
          await ctx.reply(
            "📺 <b>Pilih resolusi:</b>",
            { parse_mode: "HTML", reply_markup: resolusiKeyboard() }
          );
        }
        return;
      }

      // Subtitle
      if (pendingAct === "video_auto_subtitle") {
        const currentState = getUserState(telegramId);
        if (currentState.menuMode === "subtitle_pos") {
          setUserState(telegramId, { pendingAction: null });
          const style = currentState.subtitleStyle ?? "classic";
          const styleLabel: Record<SubtitleStyle, string> = { classic: "Classic 📝", tiktok: "TikTok Style 📱", capcut: "CapCut Style 🎬" };
          await ctx.reply(
            `📝 <b>Gaya: ${styleLabel[style]}</b>\n\n<b>Pilih posisi subtitle:</b>`,
            { parse_mode: "HTML", reply_markup: subtitlePosKeyboard() }
          );
        } else {
          setUserState(telegramId, { pendingAction: null, menuMode: "subtitle_style" });
          await ctx.reply(
            "📝 <b>Pilih gaya subtitle:</b>",
            { parse_mode: "HTML", reply_markup: subtitleStyleKeyboard() }
          );
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

    if (currentMenuMode === "subtitle_style") {
      await ctx.reply("📝 <b>Pilih gaya subtitle:</b>", { parse_mode: "HTML", reply_markup: subtitleStyleKeyboard() });
      return;
    }

    // Cek caption — langsung proses via AI
    const caption = ctx.message.caption?.trim() ?? "";
    if (caption) {
      await ctx.replyWithChatAction("typing");
      const agentResp = await runAgent(telegramId, caption);
      if (agentResp.action && agentResp.action !== "video_auto_subtitle") {
        if (agentResp.action === "video_resolution_ratio") {
          setUserState(telegramId, { menuMode: "resolusi" });
          await ctx.reply("📺 <b>Pilih resolusi:</b>", { parse_mode: "HTML", reply_markup: resolusiKeyboard() });
          return;
        }
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "video");
        return;
      }
      if (agentResp.action === "video_auto_subtitle") {
        setUserState(telegramId, { menuMode: "subtitle_style" });
        await ctx.reply("📝 <b>Pilih gaya subtitle:</b>", { parse_mode: "HTML", reply_markup: subtitleStyleKeyboard() });
        return;
      }
      await ctx.reply(agentResp.message + "\n\nPilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    await ctx.reply("🎬 Video diterima! Pilih layanan:", { reply_markup: mainInlineKeyboard() });
  });

  // ── Teks ──────────────────────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun kamu diblokir."); return; }

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
        await ctx.reply(
          "❌ Angka tidak valid. Masukkan angka <b>0–100</b>.\n\nContoh: <code>85</code>",
          { parse_mode: "HTML" }
        );
        return;
      }

      const videoUrl = state.lastVideoFileUrl;
      if (!videoUrl) {
        setUserState(telegramId, { awaitingCustomPosition: false });
        await ctx.reply("Kirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        return;
      }

      setUserState(telegramId, { awaitingCustomPosition: false, subtitleCustomY: num, subtitlePosition: "custom" });
      const style = state.subtitleStyle ?? "classic";
      await runSubtitleProcess(ctx, telegramId, videoUrl, style, "custom", num);
      return;
    }

    // ── Chat AI biasa ────────────────────────────────────────────────────────
    await ctx.replyWithChatAction("typing");
    const agentResp = await runAgent(telegramId, trimmed);

    if (agentResp.action) {
      const state2 = getUserState(telegramId);

      if (agentResp.action === "video_auto_subtitle") {
        if (state2.lastVideoFileUrl) {
          setUserState(telegramId, { menuMode: "subtitle_style" });
          await ctx.reply(agentResp.message + "\n\n📝 Pilih gaya subtitle:", { reply_markup: subtitleStyleKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: "video_auto_subtitle", menuMode: "subtitle_style" });
          await ctx.reply(agentResp.message + "\n\nKirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        }
        return;
      }

      if (agentResp.action === "video_resolution_ratio") {
        if (state2.lastVideoFileUrl) {
          setUserState(telegramId, { menuMode: "resolusi" });
          await ctx.reply(agentResp.message + "\n\n📺 Pilih resolusi:", { reply_markup: resolusiKeyboard() });
        } else {
          setUserState(telegramId, { pendingAction: "video_resolution_ratio", menuMode: "resolusi" });
          await ctx.reply(agentResp.message + "\n\nKirim videomu dulu.", { reply_markup: mainInlineKeyboard() });
        }
        return;
      }

      if (state2.lastVideoFileUrl) {
        await runEditAction(ctx, telegramId, agentResp.action, state2.lastVideoFileUrl, "video", agentResp.extraParams);
        return;
      }

      setUserState(telegramId, { pendingAction: agentResp.action });
      await ctx.reply(`${agentResp.message}\n\nKirim videomu untuk diproses.`, { reply_markup: mainInlineKeyboard() });
      return;
    }

    await ctx.reply(agentResp.message, { reply_markup: mainInlineKeyboard() });
  });

  // ── Media lain ────────────────────────────────────────────────────────────
  bot.on("message:voice",   async (ctx) => ctx.reply("Pesan suara belum didukung. Kirim video untuk edit.", { reply_markup: mainInlineKeyboard() }));
  bot.on("message:sticker", async (ctx) => ctx.reply("Pilih layanan video:", { reply_markup: mainInlineKeyboard() }));
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
    err.ctx.reply("Terjadi kesalahan. Coba lagi atau ketik /reset.", { reply_markup: mainInlineKeyboard() }).catch(() => {});
  });

  return bot;
}
