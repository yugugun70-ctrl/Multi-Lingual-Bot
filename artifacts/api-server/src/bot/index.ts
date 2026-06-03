import { Bot, GrammyError, HttpError, InputFile } from "grammy";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import { handleStart, getMenuText } from "./handlers/start";
import { handleCreditInfo, handleAkunInfo } from "./handlers/credit_info";
import { handlePremiumCommand, handlePaymentProof, handleAdminApprove } from "./handlers/premium";
import { handleAdminUsers, handleAdminStats, handleAddQuota, handleRemoveQuota, handleBan, handleBroadcast, handleTestStatus, isAdmin } from "./handlers/admin";
import { runAgent, clearHistory } from "./agent";
import { getOrCreateUser, deductQuota, getQuotaTypeForAction, getQuotaLimitMessage } from "./credits";
import { getUserState, setUserState, clearPending } from "./state";
import { executeEditAction } from "./tools";
import { generateImageNvidia } from "../lib/image-generator";
import type { EditAction, MenuMode } from "./state";

const token = process.env.TELEGRAM_BOT_TOKEN!;

// ─── Helper: download file Telegram → Buffer ──────────────────────────────────

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

async function downloadFileAsBase64(fileUrl: string): Promise<{ data: string; mediaType: string }> {
  const buf = await downloadBuffer(fileUrl);
  const mediaType = fileUrl.endsWith(".png") ? "image/png" : "image/jpeg";
  return { data: buf.toString("base64"), mediaType };
}

// ─── Helper: kirim hasil edit ke user ────────────────────────────────────────

async function sendEditResult(
  ctx: any,
  outputUrl: string,
  isVideo: boolean,
  isSubtitle: boolean,
  caption: string
): Promise<void> {
  if (isSubtitle) {
    const b64 = outputUrl.startsWith("data:") ? outputUrl.split(",")[1] : null;
    const srtBuf = b64 ? Buffer.from(b64, "base64") : null;
    if (srtBuf) {
      await ctx.replyWithDocument(new InputFile(srtBuf, "subtitle.srt"), {
        caption,
        parse_mode: "Markdown",
      });
    } else {
      await ctx.replyWithDocument(outputUrl, { caption, parse_mode: "Markdown" });
    }
    return;
  }

  if (isVideo) {
    if (outputUrl.startsWith("data:video")) {
      const buf = Buffer.from(outputUrl.split(",")[1], "base64");
      await ctx.replyWithVideo(new InputFile(buf, "editai_video.mp4"), {
        caption, parse_mode: "Markdown",
        supports_streaming: true,
      });
    } else {
      await ctx.replyWithVideo(outputUrl, { caption, parse_mode: "Markdown" });
    }
    return;
  }

  // Gambar
  if (outputUrl.startsWith("data:image")) {
    const mime = outputUrl.startsWith("data:image/png") ? "png" : "jpg";
    const buf = Buffer.from(outputUrl.split(",")[1], "base64");
    await ctx.replyWithPhoto(new InputFile(buf, `editai.${mime}`), {
      caption, parse_mode: "Markdown",
    });
  } else {
    await ctx.replyWithPhoto(outputUrl, { caption, parse_mode: "Markdown" });
  }
}

// ─── Helper: jalankan aksi edit dan kirim hasilnya ────────────────────────────

async function runEditAction(
  ctx: any,
  telegramId: number,
  action: EditAction,
  fileUrl: string,
  fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<void> {
  const quotaType = getQuotaTypeForAction(action);
  const quotaResult = await deductQuota(telegramId, quotaType);

  if (!quotaResult.success) {
    await ctx.reply(getQuotaLimitMessage(quotaType), { parse_mode: "Markdown" });
    return;
  }

  const labels: Record<string, string> = {
    photo_edit: "📷 Edit Foto", video_edit: "🎬 Edit Video", photo_to_video: "🎞️ Photo to Video",
  };
  await ctx.reply(
    `⚙️ Sedang diproses...\nBiasanya 30–120 detik 🙏\n\n${labels[quotaType] ?? "Edit"}: *${quotaResult.remaining}* sisa`,
    { parse_mode: "Markdown" }
  );
  await ctx.replyWithChatAction(
    action.includes("video") || action.includes("photo_to_video") ? "upload_video" : "upload_photo"
  );

  try {
    const result = await executeEditAction(action, fileUrl, fileType, extraParams);

    if (!result.success) {
      await ctx.reply(`❌ Gagal: ${result.error}\n\nCoba lagi atau kirim file baru.`);
      return;
    }

    if (!result.outputUrl) {
      await ctx.reply("✅ Selesai! (tidak ada file output)");
      return;
    }

    const isVideoAction =
      result.isVideo ||
      action === "text_to_video" ||
      action === "image_to_video" ||
      action.startsWith("photo_to_video") ||
      action === "video_upscale" ||
      action === "video_enhance" ||
      action === "video_stabilize" ||
      action === "video_resize" ||
      action === "video_watermark" ||
      action === "video_noise_reduction";

    const isSubtitle = action === "video_subtitle" || action === "video_caption";

    const caption =
      `✅ ${result.message ?? "Selesai!"}\n` +
      `Sisa kuota: *${quotaResult.remaining}*\n\n` +
      `_Kirim foto/video baru atau ketik angka 1–5 untuk menu._`;

    await sendEditResult(ctx, result.outputUrl, isVideoAction, isSubtitle, caption);
  } catch (err) {
    logger.error({ err }, "Edit execution error");
    await ctx.reply("❌ Terjadi kesalahan saat memproses. Coba lagi ya!");
  }
}

// ─── Teks menu untuk pilihan 1-5 ─────────────────────────────────────────────

function menuPromptFor(mode: MenuMode): string {
  switch (mode) {
    case 1: return "📷 *Edit Foto*\n\nKirim foto kamu dan tuliskan di caption apa yang ingin diedit.\n\nContoh caption: _\"hapus background\"_, _\"jadikan anime\"_, _\"perjelas foto\"_";
    case 2: return "🖼️ *Teks → Foto*\n\nKetik deskripsi gambar yang ingin dibuat.\n\nContoh: _\"Pemandangan gunung berapi di malam hari, langit berbintang, ultra realistic\"_";
    case 3: return "🎬 *Teks → Video*\n\nKetik deskripsi video yang ingin dibuat.\n\nContoh: _\"Seorang wanita berjalan di pantai saat matahari terbenam, sinematik\"_";
    case 4: return "🎞️ *Foto → Video*\n\nKirim foto kamu dan tuliskan di caption efek yang diinginkan.\n\nContoh caption: _\"cinematic\"_, _\"zoom\"_, _\"pan\"_ (default: cinematic)";
    case 5: return "✨ *Jernihkan Kualitas Video*\n\nKirim video kamu, saya akan proses: denoise, sharpen, dan tingkatkan warna secara otomatis.\n\n_(Durasi maks 30 detik)_";
    default: return getMenuText();
  }
}

// ─── Bot utama ────────────────────────────────────────────────────────────────

export function createBot(): Bot {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN harus diset.");
  const bot = new Bot(token);

  // ── Commands ──────────────────────────────────────────────────────────────
  bot.command("start", (ctx) => handleStart(ctx));

  bot.command("menu", async (ctx) => {
    await ctx.reply(getMenuText(), { parse_mode: "Markdown" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*EditAI — Bantuan*\n\n` +
      `Cara pakai:\n` +
      `1. Ketik angka *1–5* untuk memilih layanan\n` +
      `2. Ikuti instruksi yang muncul\n` +
      `3. Saat upload foto/video, tulis caption apa yang ingin dilakukan\n\n` +
      `*Menu Layanan:*\n` +
      `1️⃣ Edit Foto\n2️⃣ Teks → Foto\n3️⃣ Teks → Video\n4️⃣ Foto → Video\n5️⃣ Jernihkan Video\n\n` +
      `*Perintah:*\n` +
      `/start — Mulai ulang\n/menu — Tampilkan menu\n/akun — Info akun\n/kredit — Cek kuota\n/reset — Reset percakapan\n/premium — Upgrade Premium`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("akun", (ctx) => handleAkunInfo(ctx));
  bot.command("kredit", (ctx) => handleCreditInfo(ctx));

  bot.command("premium", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    if (args.length > 0 && isAdmin(ctx.from?.id ?? 0)) {
      await handleAdminApprove(ctx, args);
    } else {
      await handlePremiumCommand(ctx);
    }
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
    await ctx.reply("🔄 Direset! Silakan mulai dari awal.\n\n" + getMenuText(), { parse_mode: "Markdown" });
  });

  // ── Pesan Foto ────────────────────────────────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("❌ Akun kamu diblokir."); return; }

    const state = getUserState(telegramId);

    // Pembayaran premium
    if (state.awaitingPaymentProof) {
      await handlePaymentProof(ctx);
      return;
    }

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    setUserState(telegramId, { lastPhotoFileId: photo.file_id, lastPhotoFileUrl: fileUrl });

    const caption = ctx.message.caption?.trim() ?? "";

    // Mode 1: Edit foto
    if (state.menuMode === 1) {
      if (!caption) {
        await ctx.reply("📝 Tuliskan di *caption* foto apa yang ingin diedit ya!\n\nContoh: _hapus background_, _jadikan anime_, _perjelas foto_", { parse_mode: "Markdown" });
        return;
      }
      await ctx.replyWithChatAction("typing");
      let imageBase64: string | undefined;
      let imageMediaType: string | undefined;
      try {
        const dl = await downloadFileAsBase64(fileUrl);
        imageBase64 = dl.data;
        imageMediaType = dl.mediaType;
      } catch {}

      const agentResp = await runAgent(telegramId, caption, imageBase64, imageMediaType);

      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "photo", agentResp.extraParams);
      } else {
        await ctx.reply(agentResp.message + "\n\n" + getMenuText(), { parse_mode: "Markdown" });
      }
      return;
    }

    // Mode 4: Foto ke video
    if (state.menuMode === 4) {
      const style = caption.toLowerCase().includes("zoom") ? "zoom" : caption.toLowerCase().includes("pan") ? "pan" : "cinematic";
      await runEditAction(ctx, telegramId, `photo_to_video_${style}` as EditAction, fileUrl, "photo");
      return;
    }

    // Tidak ada menu dipilih — analisis AI dari caption
    if (caption) {
      await ctx.replyWithChatAction("typing");
      let imageBase64: string | undefined;
      let imageMediaType: string | undefined;
      try {
        const dl = await downloadFileAsBase64(fileUrl);
        imageBase64 = dl.data;
        imageMediaType = dl.mediaType;
      } catch {}

      const agentResp = await runAgent(telegramId, caption, imageBase64, imageMediaType);

      if (agentResp.action) {
        // Langsung eksekusi jika AI yakin
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "photo", agentResp.extraParams);
      } else if (agentResp.offTopic) {
        await ctx.reply(
          agentResp.message + "\n\n" + getMenuText(),
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.reply(agentResp.message + "\n\n_Ketik angka 1–5 untuk memilih layanan._", { parse_mode: "Markdown" });
      }
    } else {
      // Foto tanpa caption dan tanpa menu — tanya mau apa
      await ctx.reply(
        "📷 Foto kamu sudah diterima!\n\nMau diapakan fotonya?\n\n" + getMenuText(),
        { parse_mode: "Markdown" }
      );
    }
  });

  // ── Pesan Video ───────────────────────────────────────────────────────────
  bot.on("message:video", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("❌ Akun kamu diblokir."); return; }

    const state = getUserState(telegramId);
    const vid = ctx.message.video;
    const file = await ctx.api.getFile(vid.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    setUserState(telegramId, { lastVideoFileId: vid.file_id, lastVideoFileUrl: fileUrl });

    const caption = ctx.message.caption?.trim() ?? "";

    // Mode 5: Jernihkan video
    if (state.menuMode === 5) {
      await runEditAction(ctx, telegramId, "video_enhance", fileUrl, "video");
      return;
    }

    // Tanpa menu tapi ada caption → AI tentukan aksi
    if (caption) {
      await ctx.replyWithChatAction("typing");
      const agentResp = await runAgent(telegramId, caption);
      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "video", agentResp.extraParams);
        return;
      }
    }

    // Default: tawarka pilihan video
    await ctx.reply(
      "🎬 Video kamu sudah diterima!\n\nMau diapakan videonya?\n\n" +
      "5️⃣ *Jernihkan Kualitas Video* — denoise, sharpen, warna lebih hidup\n\n" +
      "Atau ketik angka *1–5* untuk layanan lain.\n\n" +
      "_Tip: Sertakan caption saat kirim video untuk langsung diproses!_",
      { parse_mode: "Markdown" }
    );
  });

  // ── Pesan Teks ────────────────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("❌ Akun kamu diblokir."); return; }

    const state = getUserState(telegramId);

    if (state.awaitingPaymentProof) {
      await ctx.reply("📸 Kirim foto/screenshot bukti pembayaran ya, bukan teks.");
      return;
    }

    const trimmed = text.trim();

    // ── Pilih menu 1–5 ────────────────────────────────────────────────────
    if (/^[1-5]$/.test(trimmed)) {
      const mode = parseInt(trimmed) as MenuMode;
      setUserState(telegramId, { menuMode: mode });
      await ctx.reply(menuPromptFor(mode), { parse_mode: "Markdown" });
      return;
    }

    // ── Mode 2: Teks → Foto ───────────────────────────────────────────────
    if (state.menuMode === 2) {
      const chatResult = await deductQuota(telegramId, "photo_edit");
      if (!chatResult.success) { await ctx.reply(getQuotaLimitMessage("photo_edit"), { parse_mode: "Markdown" }); return; }

      await ctx.reply("🖼️ Sedang membuat gambar dari deskripsimu... (30–60 detik)", { parse_mode: "Markdown" });
      await ctx.replyWithChatAction("upload_photo");

      const result = await generateImageNvidia(trimmed);
      if (result.success && result.outputUrl) {
        const mime = result.outputUrl.startsWith("data:image/png") ? "png" : "jpg";
        const buf = Buffer.from(result.outputUrl.split(",")[1], "base64");
        const caption =
          `${result.message}\nSisa kuota: *${chatResult.remaining}*\n\n_Ketik angka 1–5 untuk menu._`;
        await ctx.replyWithPhoto(new InputFile(buf, `editai.${mime}`), { caption, parse_mode: "Markdown" });
      } else {
        await ctx.reply(`❌ ${result.error}\n\nCoba lagi dengan deskripsi berbeda.`);
      }
      return;
    }

    // ── Mode 3: Teks → Video ──────────────────────────────────────────────
    if (state.menuMode === 3) {
      const quotaResult = await deductQuota(telegramId, "photo_to_video");
      if (!quotaResult.success) { await ctx.reply(getQuotaLimitMessage("photo_to_video"), { parse_mode: "Markdown" }); return; }

      await ctx.reply("🎬 Sedang membuat video dari deskripsimu... (1–3 menit)", { parse_mode: "Markdown" });
      await ctx.replyWithChatAction("upload_video");

      try {
        const result = await executeEditAction("text_to_video", "", "video", { prompt: trimmed });
        if (result.success && result.outputUrl) {
          const caption = `✅ ${result.message ?? "Video berhasil dibuat!"}\nSisa kuota: *${quotaResult.remaining}*\n\n_Ketik angka 1–5 untuk menu._`;
          if (result.outputUrl.startsWith("data:video")) {
            const buf = Buffer.from(result.outputUrl.split(",")[1], "base64");
            await ctx.replyWithVideo(new InputFile(buf, "editai_video.mp4"), { caption, parse_mode: "Markdown", supports_streaming: true });
          } else {
            await ctx.replyWithVideo(result.outputUrl, { caption, parse_mode: "Markdown" });
          }
        } else {
          await ctx.reply(`❌ ${result.error}`);
        }
      } catch (err: any) {
        await ctx.reply(`❌ Gagal membuat video: ${err.message?.slice(0, 100)}`);
      }
      return;
    }

    // ── Tidak ada menu aktif — chat AI atau arahkan ke menu ──────────────
    const chatResult = await deductQuota(telegramId, "chat");
    if (!chatResult.success) { await ctx.reply(getQuotaLimitMessage("chat"), { parse_mode: "Markdown" }); return; }

    await ctx.replyWithChatAction("typing");
    const agentResp = await runAgent(telegramId, trimmed);

    if (agentResp.offTopic) {
      await ctx.reply(
        `${agentResp.message}\n\n${getMenuText()}`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(agentResp.message + "\n\n_Ketik angka 1–5 untuk menu._", { parse_mode: "Markdown" });
    }
  });

  // ── Media lainnya ─────────────────────────────────────────────────────────
  bot.on("message:voice", async (ctx) => {
    await ctx.reply("🎤 Maaf, pesan suara belum didukung.\n\nKetik angka 1–5 untuk memilih layanan.", { parse_mode: "Markdown" });
  });

  bot.on("message:document", async (ctx) => {
    const state = getUserState(ctx.from?.id ?? 0);
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx); return; }
    await ctx.reply("📎 Untuk edit, kirim foto/video langsung (bukan sebagai file).\n\nKetik *1–5* untuk pilih layanan.", { parse_mode: "Markdown" });
  });

  bot.on("message:sticker", async (ctx) => {
    await ctx.reply("😄 Stiker keren! Ketik angka *1–5* untuk memilih layanan editing ya.", { parse_mode: "Markdown" });
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx.update }, "Bot error");
    if (err.error instanceof GrammyError) logger.error({ desc: err.error.description }, "GrammyError");
    else if (err.error instanceof HttpError) logger.error({ err: err.error }, "HttpError");
    err.ctx.reply("❌ Terjadi kesalahan. Coba lagi atau ketik /reset.").catch(() => {});
  });

  return bot;
}
