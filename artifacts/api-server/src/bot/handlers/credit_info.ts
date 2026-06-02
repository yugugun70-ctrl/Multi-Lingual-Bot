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

  await ctx.reply(
    `💳 *Info Kredit Kamu*\n\n` +
    `Status: ${user.premium ? "⭐ Premium" : "🆓 Gratis"}\n` +
    `Sisa kredit: *${user.credits}*\n` +
    `Reset dalam: *${hoursLeft} jam*\n\n` +
    `${user.premium
      ? "Kamu dapat 50 kredit per hari. Nikmati editing tanpa batas!"
      : "Paket gratis: 3 kredit/hari.\nKetik /premium untuk upgrade ke 50 kredit/hari."
    }`,
    { parse_mode: "Markdown" }
  );
}

export async function handleAkunInfo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || "-";
  const joined = new Date(user.registerDate).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric"
  });

  await ctx.reply(
    `👤 *Profil Akun*\n\n` +
    `Nama: *${name}*\n` +
    `Username: @${user.username || "-"}\n` +
    `ID: \`${user.telegramId}\`\n` +
    `Status: ${user.premium ? "⭐ Premium" : "🆓 Gratis"}\n` +
    `Kredit: *${user.credits}*\n` +
    `Bergabung: ${joined}`,
    { parse_mode: "Markdown" }
  );
}
