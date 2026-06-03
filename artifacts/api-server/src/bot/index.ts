import { Bot, GrammyError, HttpError, InputFile } from "grammy";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import { handleStart, mainInlineKeyboard, getTopUpText } from "./handlers/start";
import { handleCreditInfo, handleAkunInfo } from "./handlers/credit_info";
import { handleTopUp, handlePaymentProof, handleAdminApprove } from "./handlers/premium";
import { handleAdminUsers, handleAdminStats, handleAddQuota, handleRemoveQuota, handleBan, handleBroadcast, handleTestStatus, isAdmin } from "./handlers/admin";
import { runAgent, clearHistory } from "./agent";
import { getOrCreateUser, checkCredits, deductCredits, getCreditCost, getCreditErrorMessage } from "./credits";
import { getUserState, setUserState, clearPending } from "./state";
import { executeEditAction } from "./tools";
import { generateImageNvidia } from "../lib/image-generator";
import { getConfigValue } from "../lib/config";
import type { EditAction, MenuMode } from "./state";

// ─── Helper: download file Telegram ──────────────────────────────────────────

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
  return { data: buf.toString("base64"), mediaType: fileUrl.endsWith(".png") ? "image/png" : "image/jpeg" };
}

// ─── Helper: kirim hasil editing ke user ─────────────────────────────────────

async function sendEditResult(
  ctx: any,
  outputUrl: string,
  isVideo: boolean,
  isSubtitle: boolean,
  caption: string
): Promise<void> {
  const kb = mainInlineKeyboard();
  if (isSubtitle) {
    const buf = outputUrl.startsWith("data:") ? Buffer.from(outputUrl.split(",")[1], "base64") : null;
    if (buf) await ctx.replyWithDocument(new InputFile(buf, "subtitle.srt"), { caption, parse_mode: "Markdown", reply_markup: kb });
    else await ctx.replyWithDocument(outputUrl, { caption, parse_mode: "Markdown", reply_markup: kb });
    return;
  }
  if (isVideo) {
    if (outputUrl.startsWith("data:video")) {
      const buf = Buffer.from(outputUrl.split(",")[1], "base64");
      await ctx.replyWithVideo(new InputFile(buf, "editai_video.mp4"), { caption, parse_mode: "Markdown", supports_streaming: true, reply_markup: kb });
    } else {
      await ctx.replyWithVideo(outputUrl, { caption, parse_mode: "Markdown", reply_markup: kb });
    }
    return;
  }
  if (outputUrl.startsWith("data:image")) {
    const ext = outputUrl.startsWith("data:image/png") ? "png" : "jpg";
    const buf = Buffer.from(outputUrl.split(",")[1], "base64");
    await ctx.replyWithPhoto(new InputFile(buf, `editai.${ext}`), { caption, parse_mode: "Markdown", reply_markup: kb });
  } else {
    await ctx.replyWithPhoto(outputUrl, { caption, parse_mode: "Markdown", reply_markup: kb });
  }
}

// ─── Helper: eksekusi edit action dengan cek + deduct kredit ─────────────────

async function runEditAction(
  ctx: any,
  telegramId: number,
  action: EditAction,
  fileUrl: string,
  fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<void> {
  const cost = getCreditCost(action);

  const { ok, credits } = await checkCredits(telegramId, cost);
  if (!ok) {
    await ctx.reply(getCreditErrorMessage(cost, credits), { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
    return;
  }

  const isVidAction =
    action.startsWith("photo_to_video") || action === "image_to_video" || action === "text_to_video" ||
    action === "video_upscale" || action === "video_enhance" || action === "video_stabilize" ||
    action === "video_resize" || action === "video_watermark" || action === "video_noise_reduction";

  await ctx.reply(
    `⚙️ Sedang diproses... (30–120 detik) 🙏\n_Kredit akan dipotong hanya jika berhasil_`,
    { parse_mode: "Markdown" }
  );
  await ctx.replyWithChatAction(isVidAction ? "upload_video" : "upload_photo");

  try {
    const result = await executeEditAction(action, fileUrl, fileType, extraParams);

    if (!result.success || !result.outputUrl) {
      await ctx.reply(
        `❌ Gagal: ${result.error ?? "Terjadi kesalahan"}\n\n_Kredit tidak dikurangi._`,
        { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
      );
      return;
    }

    const deducted = await deductCredits(telegramId, cost);
    const isSubtitle = action === "video_subtitle" || action === "video_caption";
    const isVideoOut = result.isVideo || isVidAction;

    const caption =
      `✅ ${result.message ?? "Selesai!"}\n` +
      (cost > 0 ? `💳 -${cost} kredit | Sisa: *${deducted.remaining}* kredit\n` : "") +
      `\nPilih layanan lanjut 👇`;

    await sendEditResult(ctx, result.outputUrl, isVideoOut, isSubtitle, caption);
  } catch (err: any) {
    logger.error({ err }, "Edit execution error");
    await ctx.reply(
      `❌ Terjadi kesalahan: ${err.message?.slice(0, 80)}\n\n_Kredit tidak dikurangi._`,
      { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
    );
  }
}

// ─── Instruksi per mode menu ──────────────────────────────────────────────────

function getModeInstruction(mode: MenuMode): string {
  switch (mode) {
    case 1: return "📷 *Edit Foto*\n\nKirim fotomu dan tulis di *caption* apa yang ingin diedit.\n\nContoh: _hapus background_, _jadikan anime_, _perjelas_, _ubah ke kartun_";
    case 2: return "🖼️ *Teks → Foto*\n\nKetik deskripsi gambar yang ingin dibuat.\n\nContoh: _Pemandangan gunung berapi di malam hari, langit berbintang, ultra realistic_";
    case 4: return "🎞️ *Foto → Video*\n\nKirim fotomu dan tulis di *caption* efek yang diinginkan.\n\nContoh caption: _cinematic_, _zoom_, _pan_\n_(default: cinematic)_";
    case 5: return "✨ *Jernihkan Kualitas Video*\n\nKirim videomu, saya proses otomatis:\ndenoise → sharpen → warna lebih hidup\n\n_(Durasi maks 30 detik)_";
    default: return "";
  }
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

export function createBot(token: string): Bot {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN harus diset.");
  const bot = new Bot(token);

  // ── Commands ──────────────────────────────────────────────────────────────
  bot.command("start", (ctx) => handleStart(ctx));

  bot.command("menu", async (ctx) => {
    await ctx.reply("Pilih layanan 👇", { reply_markup: mainInlineKeyboard() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*EditAI — Bantuan*\n\n` +
      `Ketuk tombol di bawah pesan untuk memilih layanan:\n\n` +
      `📷 *Edit Foto* — 1 kredit\n` +
      `🎞️ *Foto → Video* — 3 kredit\n` +
      `🖼️ *Teks → Foto* — 3 kredit\n` +
      `✨ *Jernihkan Video* — 3 kredit\n` +
      `💬 *Chat AI* — GRATIS\n\n` +
      `💡 Kredit hanya dipotong jika produksi *berhasil*.\n\n` +
      `*Perintah:*\n` +
      `/start — Mulai ulang\n/kredit — Cek saldo kredit\n/akun — Info akun\n/topup — Top up kredit\n/reset — Reset percakapan`,
      { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
    );
  });

  bot.command("akun",   (ctx) => handleAkunInfo(ctx));
  bot.command("kredit", (ctx) => handleCreditInfo(ctx));
  bot.command("topup",  (ctx) => handleTopUp(ctx));

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
    await ctx.reply("🔄 Percakapan direset!\n\nPilih layanan 👇", { reply_markup: mainInlineKeyboard() });
  });

  // ── Callback Query (tombol inline di dalam pesan) ─────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const telegramId = ctx.from?.id;
    if (!telegramId) { await ctx.answerCallbackQuery(); return; }

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) {
      await ctx.answerCallbackQuery("❌ Akun kamu diblokir.");
      return;
    }

    await ctx.answerCallbackQuery();

    if (data === "menu:edit_foto") {
      setUserState(telegramId, { menuMode: 1 });
      await ctx.reply(getModeInstruction(1), { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
    } else if (data === "menu:foto_video") {
      setUserState(telegramId, { menuMode: 4 });
      await ctx.reply(getModeInstruction(4), { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
    } else if (data === "menu:teks_foto") {
      setUserState(telegramId, { menuMode: 2 });
      await ctx.reply(
        `🖼️ *Teks → Foto*\n\nKetik deskripsi gambar yang ingin dibuat:\n\nContoh: _Pemandangan gunung berapi di malam hari, langit berbintang, ultra realistic_\n\n💳 Biaya: *3 kredit* (dipotong hanya jika berhasil)`,
        { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
      );
    } else if (data === "menu:jernihkan") {
      setUserState(telegramId, { menuMode: 5 });
      await ctx.reply(getModeInstruction(5), { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
    } else if (data === "menu:topup") {
      await handleTopUp(ctx as any);
    }
  });

  // ── Foto ──────────────────────────────────────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("❌ Akun kamu diblokir."); return; }

    const state = getUserState(telegramId);

    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }

    const photo   = ctx.message.photo[ctx.message.photo.length - 1];
    const file    = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    setUserState(telegramId, { lastPhotoFileId: photo.file_id, lastPhotoFileUrl: fileUrl });

    const caption = ctx.message.caption?.trim() ?? "";

    if (state.menuMode === 1) {
      if (!caption) {
        await ctx.reply("📝 Tuliskan di *caption* apa yang ingin diedit!\n\nContoh: _hapus background_, _jadikan anime_, _perjelas_", { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
        return;
      }
      await ctx.replyWithChatAction("typing");
      let imageBase64: string | undefined, imageMediaType: string | undefined;
      try { const dl = await downloadFileAsBase64(fileUrl); imageBase64 = dl.data; imageMediaType = dl.mediaType; } catch {}
      const agentResp = await runAgent(telegramId, caption, imageBase64, imageMediaType);
      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "photo", agentResp.extraParams);
      } else {
        await ctx.reply(agentResp.message, { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
      }
      return;
    }

    if (state.menuMode === 4) {
      const style = caption.toLowerCase().includes("zoom") ? "zoom" : caption.toLowerCase().includes("pan") ? "pan" : "cinematic";
      await runEditAction(ctx, telegramId, `photo_to_video_${style}` as EditAction, fileUrl, "photo");
      return;
    }

    if (caption) {
      await ctx.replyWithChatAction("typing");
      let imageBase64: string | undefined, imageMediaType: string | undefined;
      try { const dl = await downloadFileAsBase64(fileUrl); imageBase64 = dl.data; imageMediaType = dl.mediaType; } catch {}
      const agentResp = await runAgent(telegramId, caption, imageBase64, imageMediaType);
      if (agentResp.action) {
        await runEditAction(ctx, telegramId, agentResp.action, fileUrl, "photo", agentResp.extraParams);
      } else {
        await ctx.reply(agentResp.message, { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
      }
    } else {
      await ctx.reply(
        "📷 Foto diterima!\n\nMau diapakan? Pilih dari menu di bawah, atau kirim ulang foto dengan *caption* untuk langsung diproses.",
        { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
      );
    }
  });

  // ── Video ─────────────────────────────────────────────────────────────────
  bot.on("message:video", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("❌ Akun kamu diblokir."); return; }

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
      "🎬 Video diterima!\n\nTekan *✨ Jernihkan Video* untuk meningkatkan kualitas, atau kirim ulang video dengan *caption* perintahmu.",
      { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
    );
  });

  // ── Teks ──────────────────────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
    if (user.banned) { await ctx.reply("❌ Akun kamu diblokir."); return; }

    const state   = getUserState(telegramId);
    const trimmed = text.trim();

    if (state.awaitingPaymentProof) {
      await ctx.reply("📸 Kirim foto/screenshot bukti pembayaran ya, bukan teks.", { reply_markup: mainInlineKeyboard() });
      return;
    }

    // ── Mode 2: Teks → Foto ───────────────────────────────────────────────
    if (state.menuMode === 2) {
      const { ok, credits: currentCredits } = await checkCredits(telegramId, 3);
      if (!ok) {
        await ctx.reply(getCreditErrorMessage(3, currentCredits), { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
        return;
      }
      await ctx.reply("🖼️ Sedang membuat gambar dari deskripsimu... (30–60 detik)\n_Kredit dipotong hanya jika berhasil_", { parse_mode: "Markdown" });
      await ctx.replyWithChatAction("upload_photo");

      const result = await generateImageNvidia(trimmed);
      if (result.success && result.outputUrl) {
        const deducted = await deductCredits(telegramId, 3);
        const ext = result.outputUrl.startsWith("data:image/png") ? "png" : "jpg";
        const buf = Buffer.from(result.outputUrl.split(",")[1], "base64");
        await ctx.replyWithPhoto(
          new InputFile(buf, `editai.${ext}`),
          {
            caption: `${result.message}\n💳 -3 kredit | Sisa: *${deducted.remaining}* kredit`,
            parse_mode: "Markdown",
            reply_markup: mainInlineKeyboard(),
          }
        );
      } else {
        await ctx.reply(`❌ ${result.error}\n\n_Kredit tidak dikurangi._\n\nCoba deskripsi lain.`, { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
      }
      return;
    }

    // ── Chat AI biasa — GRATIS ─────────────────────────────────────────────
    await ctx.replyWithChatAction("typing");
    const agentResp = await runAgent(telegramId, trimmed);

    if (agentResp.offTopic) {
      await ctx.reply(
        agentResp.message + "\n\n_Pilih layanan editing di bawah:_",
        { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() }
      );
    } else {
      await ctx.reply(agentResp.message, { parse_mode: "Markdown", reply_markup: mainInlineKeyboard() });
    }
  });

  // ── Media lain ─────────────────────────────────────────────────────────
  bot.on("message:voice", async (ctx) => {
    await ctx.reply("🎤 Pesan suara belum didukung.\n\nPilih layanan di bawah 👇", { reply_markup: mainInlineKeyboard() });
  });

  bot.on("message:document", async (ctx) => {
    const state = getUserState(ctx.from?.id ?? 0);
    if (state.awaitingPaymentProof) { await handlePaymentProof(ctx as any); return; }
    await ctx.reply("📎 Untuk edit, kirim foto/video langsung (bukan sebagai file).", { reply_markup: mainInlineKeyboard() });
  });

  bot.on("message:sticker", async (ctx) => {
    await ctx.reply("😄 Pilih layanan editing di bawah 👇", { reply_markup: mainInlineKeyboard() });
  });

  // ── Error ─────────────────────────────────────────────────────────────────
  bot.catch((err) => {
    logger.error({ err: err.error, update: err.ctx.update }, "Bot error");
    if (err.error instanceof GrammyError)  logger.error({ desc: err.error.description }, "GrammyError");
    else if (err.error instanceof HttpError) logger.error({ err: err.error }, "HttpError");
    err.ctx.reply("❌ Terjadi kesalahan. Coba lagi atau ketik /reset.", { reply_markup: mainInlineKeyboard() }).catch(() => {});
  });

  return bot;
}
