import type { Context } from "grammy";
import { getOrCreateUser } from "../credits";

export async function handleCreditInfo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

  const lastReset = new Date(user.lastDailyReset);
  const nextReset = new Date(lastReset.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60 * 60)));

  const statusEmoji = user.premium ? "⭐" : "🆓";
  const statusLabel = user.premium ? "Premium" : "Gratis";

  await ctx.reply(
    `💳 *Informasi Kredit Kamu*\n\n` +
    `${statusEmoji} Paket: *${statusLabel}*\n` +
    `💰 Sisa kredit: *${user.credits} kredit*\n` +
    `⏰ Reset dalam: *${hoursLeft} jam lagi*\n\n` +
    `📋 *Detail Paket:*\n` +
    `• Gratis: 3 kredit/hari\n` +
    `• Premium: 50 kredit/hari\n\n` +
    (user.premium
      ? `✨ Kamu sudah menjadi member Premium!`
      : `💡 Upgrade ke Premium untuk 50 kredit/hari!\nHubungi admin untuk info lebih lanjut.`),
    { parse_mode: "Markdown" }
  );
}
