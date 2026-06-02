import type { Context } from "grammy";
import { getOrCreateUser, FREE_CHAT_QUOTA, FREE_PHOTO_EDIT_QUOTA, FREE_VIDEO_EDIT_QUOTA, FREE_PHOTO_TO_VIDEO_QUOTA, PREMIUM_CHAT_QUOTA, PREMIUM_PHOTO_EDIT_QUOTA, PREMIUM_VIDEO_EDIT_QUOTA, PREMIUM_PHOTO_TO_VIDEO_QUOTA } from "../credits";

export async function handleCreditInfo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

  const lastReset = new Date(user.lastDailyReset);
  const nextReset = new Date(lastReset.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60 * 60)));
  const minutesLeft = Math.max(0, Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60)));

  const resetText = hoursLeft > 0 ? `${hoursLeft} jam` : `${minutesLeft} menit`;

  if (user.premium) {
    await ctx.reply(
      `💳 *Kuota Kamu — ⭐ Premium*\n\n` +
      `💬 AI Chat: *${user.chatQuota}* / ${PREMIUM_CHAT_QUOTA}\n` +
      `📷 Edit Foto: *${user.photoEditQuota}* / ${PREMIUM_PHOTO_EDIT_QUOTA}\n` +
      `🎬 Edit Video: *${user.videoEditQuota}* / ${PREMIUM_VIDEO_EDIT_QUOTA}\n` +
      `🎞️ Photo to Video: *${user.photoToVideoQuota}* / ${PREMIUM_PHOTO_TO_VIDEO_QUOTA}\n\n` +
      `🔄 Reset dalam: *${resetText}*\n\n` +
      `Terima kasih sudah jadi member Premium! 🙏`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.reply(
      `💳 *Kuota Kamu — 🆓 Gratis*\n\n` +
      `💬 AI Chat: *${user.chatQuota}* / ${FREE_CHAT_QUOTA}\n` +
      `📷 Edit Foto: *${user.photoEditQuota}* / ${FREE_PHOTO_EDIT_QUOTA}\n` +
      `🎬 Edit Video: *${user.videoEditQuota}* / ${FREE_VIDEO_EDIT_QUOTA}\n` +
      `🎞️ Photo to Video: *${user.photoToVideoQuota}* / ${FREE_PHOTO_TO_VIDEO_QUOTA}\n\n` +
      `🔄 Reset dalam: *${resetText}*\n\n` +
      `💡 *Catatan:* Kuota Chat tidak berkurang saat kamu bertanya — hanya edit yang dihitung!\n\n` +
      `Ketik /premium untuk upgrade ke Premium ⭐`,
      { parse_mode: "Markdown" }
    );
  }
}

export async function handleAkunInfo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || "-";
  const joined = new Date(user.registerDate).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric"
  });

  const lastReset = new Date(user.lastDailyReset);
  const nextReset = new Date(lastReset.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60 * 60)));

  await ctx.reply(
    `👤 *Profil Akun*\n\n` +
    `Nama: *${name}*\n` +
    `Username: @${user.username || "-"}\n` +
    `ID: \`${user.telegramId}\`\n` +
    `Status: ${user.premium ? "⭐ Premium" : "🆓 Gratis"}\n` +
    `Bergabung: ${joined}\n\n` +
    `📊 *Sisa Kuota Hari Ini:*\n` +
    `💬 Chat AI: *${user.chatQuota}*\n` +
    `📷 Edit Foto: *${user.photoEditQuota}*\n` +
    `🎬 Edit Video: *${user.videoEditQuota}*\n` +
    `🎞️ Photo to Video: *${user.photoToVideoQuota}*\n\n` +
    `🔄 Reset dalam: *${hoursLeft} jam*`,
    { parse_mode: "Markdown" }
  );
}
