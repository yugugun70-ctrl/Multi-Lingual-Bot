import type { Context } from "grammy";
import { getOrCreateUser } from "../credits";

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(
    telegramId,
    ctx.from?.username,
    ctx.from?.first_name
  );

  const name = user.firstName || user.username || "kamu";
  const isPremium = user.premium;

  await ctx.reply(
    `Hei ${name}! 👋\n\n` +
    `Saya *EditAI* — asisten AI untuk edit foto dan video.\n\n` +
    `Cara pakainya simpel banget:\n` +
    `📷 Kirim foto → saya bantu edit\n` +
    `🎬 Kirim video → saya bantu edit\n` +
    `💬 Tanya apa saja → saya jawab\n\n` +
    `Kamu tinggal kirim foto atau cerita apa yang kamu mau, saya yang urus sisanya.\n\n` +
    `${isPremium ? "⭐ Status: *Premium* — 50 kredit/hari" : `💳 Sisa kredit hari ini: *${user.credits} kredit*`}\n\n` +
    `_Mau mulai? Kirim foto atau video sekarang!_`,
    { parse_mode: "Markdown" }
  );
}
