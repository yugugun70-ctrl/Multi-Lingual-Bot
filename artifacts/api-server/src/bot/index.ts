import { Bot, GrammyError, HttpError } from "grammy";
import https from "node:https";
import http from "node:http";
import { logger } from "../lib/logger";
import { handleStart } from "./handlers/start";
import { handleCreditInfo, handleAkunInfo } from "./handlers/credit_info";
import { handlePremiumCommand, handlePaymentProof, handleAdminApprove } from "./handlers/premium";
import { handleAdminUsers, handleAdminStats, handleAddQuota, handleRemoveQuota, handleBan, handleBroadcast, isAdmin } from "./handlers/admin";
import { runAgent, clearHistory } from "./agent";
import { getOrCreateUser, deductQuota, getQuotaTypeForAction, getQuotaLimitMessage } from "./credits";
import { getUserState, setUserState, clearPending } from "./state";
import { executeEditAction } from "./tools";
import type { EditAction } from "./state";

async function downloadFileAsBase64(fileUrl: string): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const proto = fileUrl.startsWith("https") ? https : http;
    proto.get(fileUrl, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const mediaType = fileUrl.endsWith(".png") ? "image/png" : "image/jpeg";
        resolve({ data: buf.toString("base64"), mediaType });
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

export function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN harus diset.");
  const bot = new Bot(token);

  bot.command("start", (ctx) => handleStart(ctx));

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*EditAI — Asisten Editor AI*\n\n` +
      `Cara pakai super simpel:\n\n` +
      `📷 *Kirim foto* → saya analisis dan bantu edit\n` +
      `🎬 *Kirim video* → saya analisis dan bantu edit\n` +
      `💬 *Ketik pesan* → tanya apa saja tentang editing\n\n` +
      `Kamu tidak perlu pilih menu. Cukup bicara natural!\n\n` +
      `Contoh:\n` +
      `_"Tolong buat foto ini lebih profesional"_\n` +
      `_"Hapus background foto ini"_\n` +
      `_"Tren edit video TikTok sekarang apa?"_\n` +
      `_"Buat foto ini jadi anime"_\n\n` +
      `📊 *Kuota Harian (Gratis):*\n` +
      `💬 Chat AI: 50 pesan\n` +
      `📷 Edit Foto: 5 kali\n` +
      `🎬 Edit Video: 2 kali\n` +
      `🎞️ Photo to Video: 1 kali\n\n` +
      `*Perintah tersedia:*\n` +
      `/start — Mulai bot\n` +
      `/akun — Info profil kamu\n` +
      `/kredit — Cek sisa kuota\n` +
      `/premium — Upgrade ke Premium\n` +
      `/help — Bantuan ini\n\n` +
      `_Punya pertanyaan? Ketik saja langsung!_`,
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

  bot.command("users", (ctx) => handleAdminUsers(ctx));
  bot.command("stats", (ctx) => handleAdminStats(ctx));
  bot.command("addcredit", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    await handleAddQuota(ctx, args);
  });
  bot.command("removecredit", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    await handleRemoveQuota(ctx, args);
  });
  bot.command("broadcast", async (ctx) => {
    await handleBroadcast(ctx, ctx.match?.toString().trim() ?? "");
  });
  bot.command("ban", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    await handleBan(ctx, args, true);
  });
  bot.command("unban", async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    await handleBan(ctx, args, false);
  });
  bot.command("reset", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    await clearHistory(telegramId);
    clearPending(telegramId);
    await ctx.reply("🔄 Percakapan direset. Mulai lagi dari awal!");
  });

  async function processMessage(ctx: any, userText: string, imageBase64?: string, imageMediaType?: string): Promise<void> {
    const telegramId = ctx.from?.id as number;
    if (!telegramId) return;

    const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

    if (user.banned) {
      await ctx.reply("❌ Akun kamu telah diblokir. Hubungi admin untuk informasi lebih lanjut.");
      return;
    }

    const state = getUserState(telegramId);

    if (state.awaitingPaymentProof && ctx.message?.photo) {
      await handlePaymentProof(ctx);
      return;
    }

    const confirmWords = ["ya", "oke", "ok", "yap", "yep", "lakukan", "jalankan", "yes", "go", "bagus", "mantap", "setuju", "boleh", "bisa", "silakan", "do it", "sure", "proceed", "gas", "lanjut", "siap", "iyaa", "iya"];
    const cancelWords = ["tidak", "batal", "cancel", "no", "nope", "jangan", "stop", "gausah", "ga usah", "skip"];

    const lowerText = userText.toLowerCase().trim();
    const isConfirm = confirmWords.some(w => lowerText === w || lowerText.startsWith(w + " ") || lowerText.endsWith(" " + w));
    const isCancel = cancelWords.some(w => lowerText === w || lowerText.startsWith(w + " "));

    if (state.pending && isCancel) {
      clearPending(telegramId);
      await ctx.reply("Oke, dibatalkan! Ada yang lain yang bisa saya bantu?");
      return;
    }

    if (state.pending && isConfirm) {
      const pending = state.pending;
      const action = pending.action as EditAction;
      const quotaType = getQuotaTypeForAction(action);
      const quotaResult = await deductQuota(telegramId, quotaType);

      if (!quotaResult.success) {
        clearPending(telegramId);
        await ctx.reply(getQuotaLimitMessage(quotaType), { parse_mode: "Markdown" });
        return;
      }

      const quotaLabel: Record<string, string> = {
        photo_edit: "📷 Edit Foto",
        video_edit: "🎬 Edit Video",
        photo_to_video: "🎞️ Photo to Video",
      };

      await ctx.reply(
        `⚙️ Oke, sedang diproses...\n\n_${pending.description}_\n\nBiasanya butuh 30-120 detik ya 🙏\n\n${quotaLabel[quotaType] ?? "Edit"}: *${quotaResult.remaining}* sisa hari ini`,
        { parse_mode: "Markdown" }
      );

      try {
        let fileUrl = pending.fileType === "photo" ? state.lastPhotoFileUrl : null;

        if (!fileUrl) {
          const fileId = pending.fileId;
          const file = await ctx.api.getFile(fileId);
          fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        }

        if (!fileUrl) {
          await ctx.reply("❌ File tidak ditemukan. Coba kirim ulang foto/video kamu.");
          clearPending(telegramId);
          return;
        }

        const result = await executeEditAction(
          action,
          fileUrl,
          pending.fileType,
          pending.extraParams
        );

        clearPending(telegramId);

        if (!result.success) {
          if (result.error?.includes("REPLICATE_API_TOKEN")) {
            await ctx.reply(
              `⚠️ *API editing belum dikonfigurasi*\n\n` +
              `Untuk mengaktifkan fitur editing AI, admin perlu menambahkan REPLICATE_API_TOKEN.\n\n` +
              `Hubungi admin atau daftar di replicate.com untuk mendapatkan token.`,
              { parse_mode: "Markdown" }
            );
          } else {
            await ctx.reply(`❌ Gagal memproses: ${result.error}\n\nCoba lagi atau kirim foto baru.`);
          }
          return;
        }

        if (result.outputUrl) {
          const caption = `✅ Selesai! Sisa kuota: *${quotaResult.remaining}*\n\n_Ada yang mau diedit lagi? Kirim foto baru atau tanya saya!_`;
          if (result.outputUrl.startsWith("data:image")) {
            const base64Data = result.outputUrl.split(",")[1];
            const imgBuf = Buffer.from(base64Data, "base64");
            await ctx.replyWithPhoto(new Blob([imgBuf], { type: "image/png" }) as any, {
              caption,
              parse_mode: "Markdown",
            });
          } else if (pending.action === "video_subtitle" || pending.action === "video_caption") {
            await ctx.replyWithDocument(result.outputUrl, {
              caption: `✅ Subtitle berhasil dibuat! Sisa kuota: *${quotaResult.remaining}*`,
              parse_mode: "Markdown",
            });
          } else {
            await ctx.replyWithPhoto(result.outputUrl, {
              caption,
              parse_mode: "Markdown",
            });
          }
        }
      } catch (err) {
        logger.error({ err }, "Edit execution error");
        clearPending(telegramId);
        await ctx.reply("❌ Terjadi kesalahan saat memproses. Coba lagi ya!");
      }

      return;
    }

    // Deduct chat quota for AI conversation (NOT for edit actions)
    const chatResult = await deductQuota(telegramId, "chat");
    if (!chatResult.success) {
      await ctx.reply(getQuotaLimitMessage("chat"), { parse_mode: "Markdown" });
      return;
    }

    await ctx.sendChatAction("typing");

    const agentResponse = await runAgent(telegramId, userText, imageBase64, imageMediaType);

    if (agentResponse.action && agentResponse.needsConfirmation) {
      const fileId = imageBase64
        ? (ctx.message?.photo?.[ctx.message.photo.length - 1]?.file_id ?? state.lastPhotoFileId ?? "")
        : state.lastPhotoFileId ?? "";
      const fileType = imageBase64 ? "photo" : (state.lastVideoFileId ? "video" : "photo");

      setUserState(telegramId, {
        pending: {
          action: agentResponse.action,
          fileId: fileId,
          fileType,
          extraParams: agentResponse.extraParams,
          description: agentResponse.message.split("\n")[0],
        },
      });
    }

    await ctx.reply(agentResponse.message, { parse_mode: "Markdown" });
  }

  bot.on("message:photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    setUserState(telegramId, {
      lastPhotoFileId: photo.file_id,
      lastPhotoFileUrl: fileUrl,
    });

    let imageBase64: string | undefined;
    let imageMediaType: string | undefined;

    try {
      const downloaded = await downloadFileAsBase64(fileUrl);
      imageBase64 = downloaded.data;
      imageMediaType = downloaded.mediaType;
    } catch (err) {
      logger.warn({ err }, "Gagal download foto untuk vision");
    }

    const caption = ctx.message.caption ?? "";
    await processMessage(ctx, caption, imageBase64, imageMediaType);
  });

  bot.on("message:video", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    setUserState(telegramId, {
      lastVideoFileId: ctx.message.video.file_id,
    });

    const caption = ctx.message.caption ?? "";
    await processMessage(ctx, caption || "[Pengguna mengirim video]");
  });

  bot.on("message:voice", async (ctx) => {
    await ctx.reply("🎤 Maaf, saya belum bisa memproses pesan suara. Silakan ketik pesanmu ya!");
  });

  bot.on("message:document", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const state = getUserState(telegramId);
    if (state.awaitingPaymentProof) {
      await handlePaymentProof(ctx);
      return;
    }

    await ctx.reply("📎 Untuk editing, kirim foto/video langsung (bukan sebagai file). Coba lagi ya!");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const state = getUserState(telegramId);

    if (state.awaitingPaymentProof && !text.startsWith("/")) {
      await ctx.reply("Kirim foto/screenshot bukti pembayaran kamu ya, bukan teks. 📸");
      return;
    }

    await processMessage(ctx, text);
  });

  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error({ err: err.error, update: ctx.update }, "Bot error");
    if (err.error instanceof GrammyError) logger.error({ desc: err.error.description }, "GrammyError");
    else if (err.error instanceof HttpError) logger.error({ err: err.error }, "HttpError");
  });

  return bot;
}
