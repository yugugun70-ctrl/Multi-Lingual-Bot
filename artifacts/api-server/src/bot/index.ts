import { Bot, GrammyError, HttpError, InputFile } from "grammy";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import { handleStart, mainInlineKeyboard, editFotoKeyboard, editFotoTrendyKeyboard, fotoVideoKeyboard, getTopUpText } from "./handlers/start";
import { handleCreditInfo, handleAkunInfo } from "./handlers/credit_info";
import { handleTopUp, handlePaymentProof, handleAdminApprove } from "./handlers/premium";
import { handleAdminUsers, handleAdminStats, handleAddQuota, handleRemoveQuota, handleBan, handleBroadcast, handleTestStatus, isAdmin } from "./handlers/admin";
import { runAgent, clearHistory } from "./agent";
import { getOrCreateUser, checkCredits, deductCredits, getCreditCost, getCreditErrorMessage } from "./credits";
import { getUserState, setUserState, clearPending } from "./state";
import { executeEditAction } from "./tools";
import { generateImageNvidia } from "../lib/image-generator";
import type { EditAction, MenuMode } from "./state";

// ─── Markdown safety ──────────────────────────────────────────────────────────

/**
 * Kirim pesan dengan Markdown — jika gagal parse, kirim ulang tanpa parse_mode.
 * Ini mencegah crash akibat karakter Markdown tidak valid dari AI responses.
 */
async function safeReply(
  ctx: any,
  text: string,
  options: Record<string, any> = {}
): Promise<any> {
  try {
    return await ctx.reply(text, { parse_mode: "Markdown", ...options });
  } catch (err: any) {
    if (err?.description?.includes("parse entities") || err?.error_code === 400) {
      // Coba kirim tanpa parse_mode
      const { parse_mode: _pm, ...rest } = options;
      return await ctx.reply(stripMarkdown(text), rest);
    }
    throw err;
  }
}

/** Hapus karakter Markdown dari teks sehingga aman dikirim tanpa parse_mode */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`[\]]/g, "");
}

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

async function downloadFileAsBase64(fileUrl: string) {
  const buf = await downloadBuffer(fileUrl);
  return { data: buf.toString("base64"), mediaType: fileUrl.endsWith(".png") ? "image/png" : "image/jpeg" };
}

// ─── Kirim hasil edit ke user ─────────────────────────────────────────────────

async function sendEditResult(
  ctx: any, outputUrl: string, isVideo: boolean, isSubtitle: boolean, caption: string
): Promise<void> {
  const kb = mainInlineKeyboard();
  if (isSubtitle) {
    const buf = outputUrl.startsWith("data:") ? Buffer.from(outputUrl.split(",")[1], "base64") : null;
    if (buf) await ctx.replyWithDocument(new InputFile(buf, "subtitle.srt"), { caption, reply_markup: kb });
    else      await ctx.replyWithDocument(outputUrl, { caption, reply_markup: kb });
    return;
  }
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

// ─── Jalankan edit action ─────────────────────────────────────────────────────

async function runEditAction(
  ctx: any, telegramId: number, action: EditAction,
  fileUrl: string, fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<void> {
  const cost = getCreditCost(action);
  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { reply_markup: mainInlineKeyboard() });
    return;
  }

  const isVidAction =
    action.startsWith("photo_to_video") || action === "image_to_video" || action === "text_to_video" ||
    ["video_upscale","video_enhance","video_stabilize","video_resize","video_watermark","video_noise_reduction"].includes(action);

  await ctx.reply(
    `Sedang diproses... (10-120 detik) Mohon tunggu ya!\nKredit dipotong hanya jika berhasil.`
  );
  await ctx.replyWithChatAction(isVidAction ? "upload_video" : "upload_photo");

  try {
    const result = await executeEditAction(action, fileUrl, fileType, extraParams);

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `Gagal: ${result.error ?? "Terjadi kesalahan"}\n\nKredit tidak dikurangi.`,
        { reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted  = await deductCredits(telegramId, cost);
    const isSubtitle = action === "video_subtitle" || action === "video_caption";
    const isVideoOut = result.isVideo || isVidAction;
    const caption   = `${result.message ?? "Selesai!"}\n${cost > 0 ? `-${cost} kredit | Sisa: ${deducted.remaining} kredit\n` : ""}\nPilih layanan lanjut:`;

    await sendEditResult(ctx, result.outputUrl, isVideoOut, isSubtitle, caption);
  } catch (err: any) {
    logger.error({ err }, "Edit execution error");
    await ctx.reply(
      `Terjadi kesalahan: ${err.message?.slice(0, 100)}\n\nKredit tidak dikurangi.`,
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
      "EditAI — Panduan\n\n" +
      "Ketuk tombol di bawah pesan untuk memilih layanan.\n\n" +
      "Foto: Hapus BG, Perjelas, Enhance, Anime, Kartun, HDR, Glow, Sketsa, Neon, Oil Paint, Vintage\n\n" +
      "Foto ke Video: Sinematik, Zoom, Pan\n\n" +
      "Video: Jernihkan kualitas video\n\n" +
      "Kredit dipotong HANYA jika berhasil.\n\n" +
      "/kredit — cek saldo\n/topup — top up kredit\n/reset — reset percakapan",
      { reply_markup: mainInlineKeyboard() }
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

  // ── Callback Query ───────────────────────────────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data       = ctx.callbackQuery.data;
    const telegramId = ctx.from?.id;
    if (!telegramId) { await ctx.answerCallbackQuery(); return; }

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.answerCallbackQuery("Akun kamu diblokir."); return; }

    await ctx.answerCallbackQuery();

    // ── Navigasi menu ──────────────────────────────────────────────────────
    if (data === "menu:back") {
      setUserState(telegramId, { menuMode: null, pendingAction: null });
      await ctx.reply("Pilih layanan:", { reply_markup: mainInlineKeyboard() });
      return;
    }

    if (data === "menu:edit_foto") {
      setUserState(telegramId, { menuMode: 1 });
      await ctx.reply(
        "Pilih efek yang ingin diterapkan, lalu kirim foto kamu:",
        { reply_markup: editFotoKeyboard() }
      );
      return;
    }

    if (data === "menu:edit_trendy") {
      await ctx.reply(
        "Efek Trending — pilih salah satu, lalu kirim foto kamu:",
        { reply_markup: editFotoTrendyKeyboard() }
      );
      return;
    }

    if (data === "menu:foto_video") {
      setUserState(telegramId, { menuMode: 4 });
      await ctx.reply(
        "Pilih gaya efek video, lalu kirim foto kamu:",
        { reply_markup: fotoVideoKeyboard() }
      );
      return;
    }

    if (data === "menu:teks_foto") {
      setUserState(telegramId, { menuMode: 2 });
      await ctx.reply(
        "Teks ke Foto — ketik deskripsi gambar yang ingin dibuat:\n\n" +
        "Contoh: Pemandangan gunung berapi malam hari, langit berbintang, ultra realistic\n\n" +
        "Biaya: 3 kredit (dipotong hanya jika berhasil)"
      );
      return;
    }

    if (data === "menu:jernihkan") {
      setUserState(telegramId, { menuMode: 5 });
      await ctx.reply(
        "Jernihkan Kualitas Video — kirim videomu, saya proses otomatis:\ndenoise + sharpen + warna lebih hidup\n\n(Durasi maks 30 detik)"
      );
      return;
    }

    if (data === "menu:topup") {
      await handleTopUp(ctx as any);
      return;
    }

    // ── Direct Edit Actions ────────────────────────────────────────────────
    const directActions: Record<string, EditAction> = {
      "edit:remove_background":        "remove_background",
      "edit:upscale_photo":            "upscale_photo",
      "edit:enhance_photo":            "enhance_photo",
      "edit:anime_effect":             "anime_effect",
      "edit:cartoon_effect":           "cartoon_effect",
      "edit:hdr_effect":               "hdr_effect",
      "edit:glow_effect":              "glow_effect",
      "edit:sketch_effect":            "sketch_effect",
      "edit:neon_effect":              "neon_effect",
      "edit:oil_paint_effect":         "oil_paint_effect",
      "edit:vintage_effect":           "vintage_effect",
      "edit:color_correction":         "color_correction",
      "edit:photo_to_video_cinematic": "photo_to_video_cinematic",
      "edit:photo_to_video_zoom":      "photo_to_video_zoom",
      "edit:photo_to_video_pan":       "photo_to_video_pan",
    };

    const actionLabels: Record<string, string> = {
      "remove_background":       "Hapus Background",
      "upscale_photo":           "Perjelas 3x",
      "enhance_photo":           "Perbaiki Kualitas",
      "anime_effect":            "Efek Anime",
      "cartoon_effect":          "Efek Kartun",
      "hdr_effect":              "Efek HDR",
      "glow_effect":             "Efek Glow",
      "sketch_effect":           "Efek Sketsa",
      "neon_effect":             "Efek Neon",
      "oil_paint_effect":        "Lukis Minyak",
      "vintage_effect":          "Efek Vintage",
      "color_correction":        "Koreksi Warna",
      "photo_to_video_cinematic":"Video Sinematik",
      "photo_to_video_zoom":     "Video Zoom In",
      "photo_to_video_pan":      "Video Pan",
    };

    const action = directActions[data];
    if (action) {
      const label = actionLabels[action] ?? action;
      const state = getUserState(telegramId);
      const existingPhotoUrl = state.lastPhotoFileUrl;

      // Jika sudah ada foto di state, langsung proses
      if (existingPhotoUrl) {
        setUserState(telegramId, { pendingAction: null });
        await runEditAction(ctx, telegramId, action, existingPhotoUrl, "photo");
        return;
      }

      // Belum ada foto — simpan action, minta kirim foto
      setUserState(telegramId, { pendingAction: action });
      await ctx.reply(
        `${label} dipilih!\n\nSekarang kirim fotomu — saya proses langsung.\n(Kredit dipotong hanya jika berhasil)`,
        { reply_markup: mainInlineKeyboard() }
      );
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

    const photo   = ctx.message.photo[ctx.message.photo.length - 1];
    const file    = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    setUserState(telegramId, { lastPhotoFileId: photo.file_id, lastPhotoFileUrl: fileUrl });

    const caption = ctx.message.caption?.trim() ?? "";

    // PRIORITAS 1: Ada pending action dari tombol submenu
    if (state.pendingAction) {
      const action = state.pendingAction;
      setUserState(telegramId, { pendingAction: null });
      await runEditAction(ctx, telegramId, action, fileUrl, "photo");
      return;
    }

    // PRIORITAS 2: Mode Foto ke Video
    if (state.menuMode === 4) {
      const style = caption.toLowerCase().includes("zoom") ? "zoom"
                  : caption.toLowerCase().includes("pan")  ? "pan"
                  : "cinematic";
      await runEditAction(ctx, telegramId, `photo_to_video_${style}` as EditAction, fileUrl, "photo");
      return;
    }

    // PRIORITAS 3: Caption — keyword detection atau AI
    if (caption) {
      await ctx.replyWithChatAction("typing");

      const quickAction = detectActionFromCaption(caption);
      if (quickAction) {
        await runEditAction(ctx, telegramId, quickAction, fileUrl, "photo");
        return;
      }

      let imageBase64: string | undefined, imageMediaType: string | undefined;
      try { const dl = await downloadFileAsBase64(fileUrl); imageBase64 = dl.data; imageMediaType = dl.mediaType; } catch {}
      const agentResp = await runAgent(telegramId, caption, imageBase64, imageMediaType);
      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "photo", agentResp.extraParams);
      } else {
        // Kirim tanpa parse_mode untuk mencegah Markdown error dari AI response
        await ctx.reply(
          agentResp.message + "\n\nPilih efek dari tombol di bawah:",
          { reply_markup: editFotoKeyboard() }
        );
      }
      return;
    }

    // Tidak ada mode/caption — tampilkan submenu
    await ctx.reply("Foto diterima! Pilih efek yang ingin diterapkan:", { reply_markup: editFotoKeyboard() });
    setUserState(telegramId, { menuMode: 1 });
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

    if (state.menuMode === 5) {
      await runEditAction(ctx, telegramId, "video_enhance", fileUrl, "video");
      return;
    }

    const caption = ctx.message.caption?.trim() ?? "";
    if (caption) {
      await ctx.replyWithChatAction("typing");
      const agentResp = await runAgent(telegramId, caption);
      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "video", agentResp.extraParams);
        return;
      }
    }

    await ctx.reply(
      "Video diterima!\n\n" +
      "• Ketuk Jernihkan Video dari menu untuk tingkatkan kualitas\n" +
      "• Atau kirim ulang video dengan caption perintahmu",
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

    // Mode Teks ke Foto
    if (state.menuMode === 2) {
      const { ok, credits: currentCredits } = await checkCredits(telegramId, 3);
      if (!ok) {
        await ctx.reply(getCreditErrorMessage(3, currentCredits), { reply_markup: mainInlineKeyboard() });
        return;
      }
      await ctx.reply("Sedang membuat gambar... (30-60 detik)\nKredit dipotong hanya jika berhasil.");
      await ctx.replyWithChatAction("upload_photo");

      const result = await generateImageNvidia(trimmed);
      if (result.success && result.outputUrl) {
        const deducted = await deductCredits(telegramId, 3);
        const ext = result.outputUrl.startsWith("data:image/png") ? "png" : "jpg";
        const buf = Buffer.from(result.outputUrl.split(",")[1], "base64");
        await ctx.replyWithPhoto(
          new InputFile(buf, `editai.${ext}`),
          { caption: `${result.message}\n-3 kredit | Sisa: ${deducted.remaining} kredit`, reply_markup: mainInlineKeyboard() }
        );
      } else {
        await ctx.reply(result.error ?? "Gagal membuat gambar.", { reply_markup: mainInlineKeyboard() });
      }
      return;
    }

    // Ada foto di state + user ketik perintah
    if (state.lastPhotoFileUrl && state.menuMode === 1) {
      const quickAction = detectActionFromCaption(trimmed);
      if (quickAction) {
        const fileUrl = state.lastPhotoFileUrl as string;
        setUserState(telegramId, { menuMode: null });
        await runEditAction(ctx, telegramId, quickAction, fileUrl, "photo");
        return;
      }
    }

    // Chat AI biasa — TANPA parse_mode untuk mencegah Markdown crash
    await ctx.replyWithChatAction("typing");
    const agentResp = await runAgent(telegramId, trimmed);

    await ctx.reply(agentResp.message, { reply_markup: mainInlineKeyboard() });
  });

  // ── Media lain ────────────────────────────────────────────────────────────
  bot.on("message:voice",    async (ctx) => ctx.reply("Pesan suara belum didukung.", { reply_markup: mainInlineKeyboard() }));
  bot.on("message:sticker",  async (ctx) => ctx.reply("Pilih layanan editing:", { reply_markup: mainInlineKeyboard() }));
  bot.on("message:document", async (ctx) => {
    const state = getUserState(ctx.from?.id ?? 0);
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }
    await ctx.reply("Kirim foto/video langsung (bukan sebagai file).", { reply_markup: mainInlineKeyboard() });
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

// ─── Keyword detection ────────────────────────────────────────────────────────

function detectActionFromCaption(text: string): EditAction | null {
  const t = text.toLowerCase();

  if (/hapus.*(bg|background|latar)|remove.*(bg|background)|transparent/i.test(t)) return "remove_background";
  if (/upscale|perbesar|perjelas|zoom|tajam|hd|high.?res|resolusi/i.test(t)) return "upscale_photo";
  if (/enhance|perbaiki|tingkatkan|jernih|bersih|improve|kualitas/i.test(t)) return "enhance_photo";
  if (/anime|animasi/i.test(t)) return "anime_effect";
  if (/kartun|cartoon|comic/i.test(t)) return "cartoon_effect";
  if (/hdr|dynamic.?range|dramatis|kontras/i.test(t)) return "hdr_effect";
  if (/glow|bloom|dreamy|cahaya|bersinar|soft.?light/i.test(t)) return "glow_effect";
  if (/sketsa|sketch|pensil|pencil|drawing/i.test(t)) return "sketch_effect";
  if (/neon|cyberpunk|cyber|kelap.kelip/i.test(t)) return "neon_effect";
  if (/lukis.minyak|oil.paint|painting/i.test(t)) return "oil_paint_effect";
  if (/vintage|retro|jadul|film.grain|analog|klasik/i.test(t)) return "vintage_effect";
  if (/warna|color|saturasi|cerah|vivid|koreksi/i.test(t)) return "color_correction";
  if (/portrait|wajah|kulit|skin|face|muka/i.test(t)) return "portrait_enhance";
  if (/video.*sinema|sinema|cinematic/i.test(t)) return "photo_to_video_cinematic";
  if (/video.*zoom|zoom.*video/i.test(t)) return "photo_to_video_zoom";
  if (/video.*pan|pan.*video/i.test(t)) return "photo_to_video_pan";
  if (/video|gerak|animat/i.test(t)) return "photo_to_video_cinematic";

  return null;
}
