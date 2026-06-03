import { Bot, GrammyError, HttpError, InputFile } from "grammy";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import {
  handleStart,
  mainInlineKeyboard,
  kualitasKeyboard,
  efekVideoKeyboard,
  rasioVideoKeyboard,
  subtitlePosKeyboard,
  fotoVideoKeyboard,
  getTopUpText,
} from "./handlers/start";
import { handleCreditInfo, handleAkunInfo } from "./handlers/credit_info";
import { handleTopUp, handlePaymentProof, handleAdminApprove } from "./handlers/premium";
import { handleAdminUsers, handleAdminStats, handleAddQuota, handleRemoveQuota, handleBan, handleBroadcast, handleTestStatus, isAdmin } from "./handlers/admin";
import { runAgent, clearHistory } from "./agent";
import { getOrCreateUser, checkCredits, deductCredits, getCreditCost, getCreditErrorMessage, VIDEO_EDIT_COST } from "./credits";
import { getUserState, setUserState, clearPending } from "./state";
import { executeEditAction } from "./tools";
import type { EditAction } from "./state";

// ─── Download helper ──────────────────────────────────────────────────────────

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

// ─── Kirim hasil edit ke user ─────────────────────────────────────────────────

async function sendEditResult(
  ctx: any, outputUrl: string, isVideo: boolean, caption: string
): Promise<void> {
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
  // fallback: kirim sebagai foto
  if (outputUrl.startsWith("data:image")) {
    const ext = outputUrl.startsWith("data:image/png") ? "png" : "jpg";
    const buf = Buffer.from(outputUrl.split(",")[1], "base64");
    await ctx.replyWithPhoto(new InputFile(buf, `editai.${ext}`), { caption, reply_markup: kb });
  } else {
    await ctx.replyWithPhoto(outputUrl, { caption, reply_markup: kb });
  }
}

// ─── Jalankan edit action ─────────────────────────────────────────────────────

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

  await ctx.reply(`⏳ Sedang diproses... (10–120 detik)\nKredit dipotong hanya jika berhasil.`);
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
    const isVideoOut = result.isVideo ?? true;
    const caption = `${result.message ?? "Selesai!"}\n${cost > 0 ? `-${cost} kredit | Sisa: ${deducted.remaining} kredit\n` : ""}\nPilih layanan lanjut:`;

    await sendEditResult(ctx, result.outputUrl, isVideoOut, caption);
  } catch (err: any) {
    logger.error({ err }, "Edit execution error");
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
  bot.command("start",  (ctx) => handleStart(ctx));
  bot.command("menu",   async (ctx) => ctx.reply("Pilih layanan:", { reply_markup: mainInlineKeyboard() }));
  bot.command("akun",   (ctx) => handleAkunInfo(ctx));
  bot.command("kredit", (ctx) => handleCreditInfo(ctx));
  bot.command("topup",  (ctx) => handleTopUp(ctx));

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "✂️ <b>EditAI — Bot Edit Video</b>\n\n" +
      "Kirim video ke saya, lalu pilih layanan:\n\n" +
      "✨ <b>Jernihkan Video</b> — denoise + sharpen + warna hidup\n" +
      "📐 <b>Kualitas Video</b> — konversi ke HD, Full HD, atau 4K\n" +
      "🎞️ <b>Efek Video</b> — Sinematik, Hitam & Putih, Vintage, Drama, Vivid\n" +
      "📏 <b>Rasio Video</b> — 16:9, 9:16 (Reels), 1:1, 4:3, 21:9\n" +
      "💬 <b>Subtitle</b> — tambah teks di atas/tengah/bawah video\n" +
      "🎬 <b>Foto → Video</b> — ubah foto jadi video (Sinematik/Zoom/Pan)\n\n" +
      `💳 Semua fitur = <b>${VIDEO_EDIT_COST} kredit</b> per proses\n` +
      "Kredit dipotong HANYA jika berhasil.\n\n" +
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
    setUserState(telegramId, { menuMode: null });
    await ctx.reply("Reset! Pilih layanan:", { reply_markup: mainInlineKeyboard() });
  });

  // ── Callback Query ────────────────────────────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data       = ctx.callbackQuery.data;
    const telegramId = ctx.from?.id;
    if (!telegramId) { await ctx.answerCallbackQuery(); return; }

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.answerCallbackQuery("Akun kamu diblokir."); return; }

    await ctx.answerCallbackQuery();

    // ── Navigasi menu ────────────────────────────────────────────────────────
    if (data === "menu:back") {
      setUserState(telegramId, { menuMode: null, pendingAction: null, awaitingSubtitleText: false });
      await ctx.reply("Pilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    if (data === "menu:jernihkan") {
      setUserState(telegramId, { menuMode: "main", pendingAction: "video_enhance" });
      const state = getUserState(telegramId);
      if (state.lastVideoFileUrl) {
        const url = state.lastVideoFileUrl;
        setUserState(telegramId, { pendingAction: null });
        await runEditAction(ctx, telegramId, "video_enhance", url, "video");
      } else {
        await ctx.reply("✨ <b>Jernihkan Video</b>\n\nKirim videomu sekarang — saya proses otomatis:\ndenoise + sharpen + warna lebih hidup\n\n<i>(Durasi maks 30 detik)</i>", { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "menu:kualitas") {
      setUserState(telegramId, { menuMode: "kualitas" });
      await ctx.reply(
        "📐 <b>Kualitas Video</b>\n\nPilih resolusi target, lalu kirim videomu:",
        { parse_mode: "HTML", reply_markup: kualitasKeyboard() }
      );
      return;
    }

    if (data === "menu:efek") {
      setUserState(telegramId, { menuMode: "efek" });
      await ctx.reply(
        "🎞️ <b>Efek Video</b>\n\nPilih efek yang ingin diterapkan, lalu kirim videomu:",
        { parse_mode: "HTML", reply_markup: efekVideoKeyboard() }
      );
      return;
    }

    if (data === "menu:rasio") {
      setUserState(telegramId, { menuMode: "rasio" });
      await ctx.reply(
        "📏 <b>Rasio Video</b>\n\nPilih rasio yang diinginkan, lalu kirim videomu:",
        { parse_mode: "HTML", reply_markup: rasioVideoKeyboard() }
      );
      return;
    }

    if (data === "menu:subtitle") {
      setUserState(telegramId, { menuMode: "subtitle_pos", awaitingSubtitleText: false });
      const state = getUserState(telegramId);
      if (!state.lastVideoFileUrl) {
        await ctx.reply("💬 <b>Tambah Subtitle</b>\n\nKirim videomu dulu, lalu pilih posisi teks.", { parse_mode: "HTML" });
        return;
      }
      await ctx.reply(
        "💬 <b>Posisi Subtitle</b>\n\nPilih di mana teks akan muncul:",
        { parse_mode: "HTML", reply_markup: subtitlePosKeyboard() }
      );
      return;
    }

    if (data === "menu:foto_video") {
      setUserState(telegramId, { menuMode: "foto_video" });
      await ctx.reply(
        "🎬 <b>Foto → Video</b>\n\nPilih gaya efek, lalu kirim fotomu:",
        { parse_mode: "HTML", reply_markup: fotoVideoKeyboard() }
      );
      return;
    }

    if (data === "menu:topup") {
      await handleTopUp(ctx as any);
      return;
    }

    // ── Pilih posisi subtitle ────────────────────────────────────────────────
    if (data.startsWith("subtitle_pos:")) {
      const pos = data.replace("subtitle_pos:", "") as "top" | "middle" | "bottom";
      const posLabel: Record<string, string> = { top: "Atas ⬆️", middle: "Tengah ↕️", bottom: "Bawah ⬇️" };
      setUserState(telegramId, { subtitlePosition: pos, awaitingSubtitleText: true, menuMode: "subtitle_pos" });
      await ctx.reply(
        `💬 Posisi terpilih: <b>${posLabel[pos]}</b>\n\nSekarang ketik teks subtitle yang ingin ditambahkan:\n\n<i>Contoh: "Pemandangan indah di Bali" atau "Part 1 — Perjalanan dimulai"</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Direct Edit Actions dari tombol ──────────────────────────────────────
    const directActions: Record<string, EditAction> = {
      "edit:video_quality_hd":         "video_quality_hd",
      "edit:video_quality_fhd":        "video_quality_fhd",
      "edit:video_quality_4k":         "video_quality_4k",
      "edit:video_effect_cinematic":   "video_effect_cinematic",
      "edit:video_effect_bw":          "video_effect_bw",
      "edit:video_effect_vintage":     "video_effect_vintage",
      "edit:video_effect_drama":       "video_effect_drama",
      "edit:video_effect_vivid":       "video_effect_vivid",
      "edit:video_ratio_16_9":         "video_ratio_16_9",
      "edit:video_ratio_9_16":         "video_ratio_9_16",
      "edit:video_ratio_1_1":          "video_ratio_1_1",
      "edit:video_ratio_4_3":          "video_ratio_4_3",
      "edit:video_ratio_21_9":         "video_ratio_21_9",
      "edit:photo_to_video_cinematic": "photo_to_video_cinematic",
      "edit:photo_to_video_zoom":      "photo_to_video_zoom",
      "edit:photo_to_video_pan":       "photo_to_video_pan",
    };

    const actionLabels: Record<string, string> = {
      "video_quality_hd":        "HD (720p)",
      "video_quality_fhd":       "Full HD (1080p)",
      "video_quality_4k":        "4K (2160p)",
      "video_effect_cinematic":  "Efek Sinematik",
      "video_effect_bw":         "Hitam & Putih",
      "video_effect_vintage":    "Vintage/Retro",
      "video_effect_drama":      "Drama",
      "video_effect_vivid":      "Vivid/Cerah",
      "video_ratio_16_9":        "16:9 Landscape",
      "video_ratio_9_16":        "9:16 Reels/TikTok",
      "video_ratio_1_1":         "1:1 Square",
      "video_ratio_4_3":         "4:3 Klasik",
      "video_ratio_21_9":        "21:9 Sinema",
      "photo_to_video_cinematic":"Video Sinematik",
      "photo_to_video_zoom":     "Video Zoom In",
      "photo_to_video_pan":      "Video Pan",
    };

    const action = directActions[data];
    if (action) {
      const label = actionLabels[action] ?? action;
      const state = getUserState(telegramId);

      // Foto → Video perlu foto
      const isPhotoToVideo = action.startsWith("photo_to_video_");
      if (isPhotoToVideo) {
        if (state.lastPhotoFileUrl) {
          setUserState(telegramId, { pendingAction: null });
          await runEditAction(ctx, telegramId, action, state.lastPhotoFileUrl, "photo");
        } else {
          setUserState(telegramId, { pendingAction: action });
          await ctx.reply(
            `🎬 <b>${label}</b> dipilih!\n\nKirim fotomu — saya ubah jadi video.\n<i>(Kredit dipotong hanya jika berhasil)</i>`,
            { parse_mode: "HTML" }
          );
        }
        return;
      }

      // Video actions perlu video
      if (state.lastVideoFileUrl) {
        setUserState(telegramId, { pendingAction: null });
        await runEditAction(ctx, telegramId, action, state.lastVideoFileUrl, "video");
      } else {
        setUserState(telegramId, { pendingAction: action });
        await ctx.reply(
          `✅ <b>${label}</b> dipilih!\n\nKirim videomu sekarang — saya proses langsung.\n<i>(Kredit dipotong hanya jika berhasil)</i>`,
          { parse_mode: "HTML" }
        );
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

    // Cek bukti pembayaran
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }

    const photo   = ctx.message.photo[ctx.message.photo.length - 1];
    const file    = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    setUserState(telegramId, { lastPhotoFileId: photo.file_id, lastPhotoFileUrl: fileUrl });

    // Ada pending action foto-to-video dari tombol
    if (state.pendingAction?.startsWith("photo_to_video_")) {
      const action = state.pendingAction;
      setUserState(telegramId, { pendingAction: null });
      await runEditAction(ctx, telegramId, action, fileUrl, "photo");
      return;
    }

    // Mode foto → video
    if (state.menuMode === "foto_video") {
      const caption = ctx.message.caption?.toLowerCase() ?? "";
      const type = caption.includes("zoom") ? "photo_to_video_zoom"
                 : caption.includes("pan")  ? "photo_to_video_pan"
                 : "photo_to_video_cinematic";
      await runEditAction(ctx, telegramId, type as EditAction, fileUrl, "photo");
      return;
    }

    // Foto biasa — tawarkan konversi ke video
    const caption = ctx.message.caption?.trim() ?? "";
    if (caption) {
      await ctx.replyWithChatAction("typing");
      const agentResp = await runAgent(telegramId, caption);
      if (agentResp.action?.startsWith("photo_to_video_")) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "photo", agentResp.extraParams);
        return;
      }
      await ctx.reply(agentResp.message + "\n\nPilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    await ctx.reply(
      "📸 Foto diterima!\n\nIngin ubah foto ini jadi video?\nPilih layanan 👇",
      { reply_markup: fotoVideoKeyboard() }
    );
    setUserState(telegramId, { menuMode: "foto_video" });
  });

  // ── Video ──────────────────────────────────────────────────────────────────
  bot.on("message:video", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("Akun kamu diblokir."); return; }

    const state   = getUserState(telegramId);
    const vid     = ctx.message.video;
    const file    = await ctx.api.getFile(vid.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    setUserState(telegramId, { lastVideoFileId: vid.file_id, lastVideoFileUrl: fileUrl });

    // Ada pending action dari tombol
    if (state.pendingAction && !state.pendingAction.startsWith("photo_to_video_")) {
      const action = state.pendingAction;
      setUserState(telegramId, { pendingAction: null });
      await runEditAction(ctx, telegramId, action, fileUrl, "video");
      return;
    }

    // Mode jernihkan
    if (state.menuMode === "main" && state.pendingAction === "video_enhance") {
      setUserState(telegramId, { pendingAction: null });
      await runEditAction(ctx, telegramId, "video_enhance", fileUrl, "video");
      return;
    }

    // Mode subtitle — video baru, minta posisi
    if (state.menuMode === "subtitle_pos") {
      await ctx.reply(
        "💬 <b>Posisi Subtitle</b>\n\nPilih di mana teks akan muncul:",
        { parse_mode: "HTML", reply_markup: subtitlePosKeyboard() }
      );
      return;
    }

    // Caption = AI deteksi perintah
    const caption = ctx.message.caption?.trim() ?? "";
    if (caption) {
      await ctx.replyWithChatAction("typing");
      const agentResp = await runAgent(telegramId, caption);
      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "video", agentResp.extraParams);
        return;
      }
      await ctx.reply(agentResp.message + "\n\nPilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    // Tampilkan menu utama
    await ctx.reply(
      "🎬 Video diterima!\n\nPilih layanan yang ingin kamu gunakan:",
      { reply_markup: mainInlineKeyboard() }
    );
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

    // ── Mode Subtitle: user ketik teks subtitle ──────────────────────────────
    if (state.awaitingSubtitleText) {
      const videoUrl = state.lastVideoFileUrl;
      if (!videoUrl) {
        await ctx.reply("Kirim videomu dulu sebelum menambahkan subtitle.", { reply_markup: mainInlineKeyboard() });
        setUserState(telegramId, { awaitingSubtitleText: false });
        return;
      }

      const position = state.subtitlePosition ?? "bottom";
      setUserState(telegramId, { awaitingSubtitleText: false, menuMode: null });
      await runEditAction(ctx, telegramId, "video_subtitle", videoUrl, "video", {
        text: trimmed,
        position,
      });
      return;
    }

    // ── Chat AI biasa ────────────────────────────────────────────────────────
    await ctx.replyWithChatAction("typing");
    const agentResp = await runAgent(telegramId, trimmed);

    if (agentResp.action) {
      const state2 = getUserState(telegramId);
      // Jika ada video di state, langsung proses
      if (state2.lastVideoFileUrl && !agentResp.action.startsWith("photo_to_video_")) {
        await runEditAction(ctx, telegramId, agentResp.action, state2.lastVideoFileUrl, "video", agentResp.extraParams);
        return;
      }
      if (agentResp.action.startsWith("photo_to_video_") && state2.lastPhotoFileUrl) {
        await runEditAction(ctx, telegramId, agentResp.action, state2.lastPhotoFileUrl, "photo", agentResp.extraParams);
        return;
      }
      // Simpan action, minta kirim video/foto
      setUserState(telegramId, { pendingAction: agentResp.action });
      const needPhoto = agentResp.action.startsWith("photo_to_video_");
      await ctx.reply(
        `${agentResp.message}\n\nKirim ${needPhoto ? "foto" : "video"}mu sekarang untuk diproses.`,
        { reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    await ctx.reply(agentResp.message, { reply_markup: mainInlineKeyboard() });
  });

  // ── Media lain ────────────────────────────────────────────────────────────
  bot.on("message:voice",   async (ctx) => ctx.reply("Pesan suara belum didukung.", { reply_markup: mainInlineKeyboard() }));
  bot.on("message:sticker", async (ctx) => ctx.reply("Pilih layanan video editing:", { reply_markup: mainInlineKeyboard() }));
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
