import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, FREE_CHAT_QUOTA, FREE_PHOTO_EDIT_QUOTA, FREE_VIDEO_EDIT_QUOTA, FREE_PHOTO_TO_VIDEO_QUOTA, PREMIUM_CHAT_QUOTA, PREMIUM_PHOTO_EDIT_QUOTA, PREMIUM_VIDEO_EDIT_QUOTA, PREMIUM_PHOTO_TO_VIDEO_QUOTA } from "../credits";
import { getUserState, setUserState } from "../state";

const PREMIUM_PRICE = process.env.PREMIUM_PRICE ?? "20000";
const PREMIUM_DURATION = process.env.PREMIUM_DURATION_DAYS ?? "30";
const PAYMENT_BANK = process.env.PAYMENT_INFO_BANK;
const PAYMENT_EWALLET = process.env.PAYMENT_INFO_EWALLET;

export async function handlePremiumCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

  if (user.premium) {
    await ctx.reply(
      `⭐ *Kamu sudah Premium!*\n\n` +
      `Kamu menikmati:\n` +
      `• 💬 *${PREMIUM_CHAT_QUOTA} pesan AI per hari*\n` +
      `• 📷 *${PREMIUM_PHOTO_EDIT_QUOTA} edit foto per hari*\n` +
      `• 🎬 *${PREMIUM_VIDEO_EDIT_QUOTA} proses video per hari*\n` +
      `• 🎞️ *${PREMIUM_PHOTO_TO_VIDEO_QUOTA} photo-to-video per hari*\n\n` +
      `Terima kasih sudah mendukung EditAI! 🙏`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  let paymentInfo = "";
  if (PAYMENT_BANK) paymentInfo += `🏦 *Transfer Bank:*\n\`${PAYMENT_BANK}\`\n\n`;
  if (PAYMENT_EWALLET) paymentInfo += `📱 *E-Wallet (GoPay/OVO/Dana/dll):*\n\`${PAYMENT_EWALLET}\`\n\n`;

  if (!paymentInfo) {
    paymentInfo = "📞 *Hubungi admin* untuk info pembayaran.\n\n";
  }

  await ctx.reply(
    `⭐ *Upgrade ke Premium — Rp ${parseInt(PREMIUM_PRICE).toLocaleString("id-ID")}/bulan*\n\n` +
    `Dengan Premium kamu mendapatkan:\n\n` +
    `💬 *AI Chat:* ${PREMIUM_CHAT_QUOTA} pesan/hari _(vs 50 gratis)_\n` +
    `📷 *Edit Foto:* ${PREMIUM_PHOTO_EDIT_QUOTA} edit/hari _(vs 5 gratis)_\n` +
    `🎬 *Edit Video:* ${PREMIUM_VIDEO_EDIT_QUOTA} proses/hari _(vs 2 gratis)_\n` +
    `🎞️ *Photo to Video:* ${PREMIUM_PHOTO_TO_VIDEO_QUOTA} proses/hari _(vs 1 gratis)_\n` +
    `⚡ *Prioritas antrian* — lebih cepat diproses\n` +
    `🆕 *Akses fitur baru* lebih awal\n\n` +
    `💰 *Harga:* Rp ${parseInt(PREMIUM_PRICE).toLocaleString("id-ID")} / ${PREMIUM_DURATION} hari\n\n` +
    `${paymentInfo}` +
    `*Cara berlangganan:*\n` +
    `1. Transfer sesuai nominal di atas\n` +
    `2. Kirim bukti transfer ke bot ini (foto struk)\n` +
    `3. Admin akan mengaktifkan Premium kamu\n\n` +
    `_Setelah transfer, kirim foto bukti pembayaran ke chat ini._`,
    { parse_mode: "Markdown" }
  );

  setUserState(telegramId, { awaitingPaymentProof: true });
}

export async function handlePaymentProof(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
    : [];

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || `User ${telegramId}`;

  await ctx.reply(
    `✅ *Bukti pembayaran diterima!*\n\n` +
    `Terima kasih ${name}! Admin akan memverifikasi pembayaran kamu dalam waktu *1x24 jam*.\n\n` +
    `Setelah dikonfirmasi, akun kamu akan otomatis diupgrade ke Premium. 🙏`,
    { parse_mode: "Markdown" }
  );

  for (const adminId of ADMIN_IDS) {
    try {
      await ctx.api.sendMessage(
        adminId,
        `💳 *Permintaan Premium Baru!*\n\n` +
        `👤 Nama: ${name}\n` +
        `🆔 Telegram ID: \`${telegramId}\`\n` +
        `👤 Username: @${user.username || "-"}\n\n` +
        `Gunakan perintah:\n\`/premium ${telegramId}\`\nuntuk mengaktifkan Premium.`,
        { parse_mode: "Markdown" }
      );

      if (ctx.message?.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        await ctx.api.forwardMessage(adminId, telegramId, ctx.message.message_id);
        void photo;
      }
    } catch (e) {
      void e;
    }
  }

  setUserState(telegramId, { awaitingPaymentProof: false });
}

export async function handleAdminApprove(ctx: Context, args: string[]): Promise<void> {
  const adminId = ctx.from?.id;
  const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
    : [];

  if (!adminId || !ADMIN_IDS.includes(adminId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }

  if (args.length < 1) {
    await ctx.reply("Format: /premium [telegram_id]\nContoh: /premium 123456789");
    return;
  }

  const targetId = parseInt(args[0]);
  if (isNaN(targetId)) {
    await ctx.reply("❌ ID tidak valid.");
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) {
    await ctx.reply("❌ User tidak ditemukan.");
    return;
  }

  const newStatus = !user.premium;
  await db
    .update(usersTable)
    .set({
      premium: newStatus,
      chatQuota: newStatus ? PREMIUM_CHAT_QUOTA : FREE_CHAT_QUOTA,
      photoEditQuota: newStatus ? PREMIUM_PHOTO_EDIT_QUOTA : FREE_PHOTO_EDIT_QUOTA,
      videoEditQuota: newStatus ? PREMIUM_VIDEO_EDIT_QUOTA : FREE_VIDEO_EDIT_QUOTA,
      photoToVideoQuota: newStatus ? PREMIUM_PHOTO_TO_VIDEO_QUOTA : FREE_PHOTO_TO_VIDEO_QUOTA,
    })
    .where(eq(usersTable.telegramId, targetId));

  await ctx.reply(
    `✅ User \`${targetId}\` berhasil ${newStatus ? "diupgrade ke ⭐ *Premium*" : "dikembalikan ke 🆓 *Gratis*"}`,
    { parse_mode: "Markdown" }
  );

  try {
    await ctx.api.sendMessage(
      targetId,
      newStatus
        ? `🎉 *Selamat! Akun kamu sudah diupgrade ke Premium!*\n\n` +
          `Kamu sekarang mendapatkan:\n` +
          `• 💬 *${PREMIUM_CHAT_QUOTA} pesan AI per hari*\n` +
          `• 📷 *${PREMIUM_PHOTO_EDIT_QUOTA} edit foto per hari*\n` +
          `• 🎬 *${PREMIUM_VIDEO_EDIT_QUOTA} proses video per hari*\n` +
          `• 🎞️ *${PREMIUM_PHOTO_TO_VIDEO_QUOTA} photo-to-video per hari*\n\n` +
          `Terima kasih telah mendukung EditAI! ⭐`
        : `ℹ️ Status Premium kamu telah berakhir. Kamu kini menggunakan paket Gratis.\n\nKetik /premium untuk berlangganan kembali.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    void e;
  }
}
