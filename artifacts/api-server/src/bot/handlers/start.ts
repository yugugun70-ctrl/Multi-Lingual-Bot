import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
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

  // Remove any existing reply keyboard
  await ctx.reply("...", {
    reply_markup: { remove_keyboard: true },
  }).catch(() => {});

  await ctx.reply(
    `Hei ${name}! 👋\n\n` +
    `Saya *EditAI* — asisten AI untuk edit foto dan video.\n\n` +
    `Seperti ChatGPT, kamu bisa ngobrol natural sama saya:\n\n` +
    `📷 *Kirim foto* → saya analisis dan bantu edit\n` +
    `🎬 *Kirim video* → subtitle, jernihkan, resize, dll\n` +
    `💬 *Ketik apa saja* → tanya, konsultasi, ide konten\n\n` +
    `*Contoh yang bisa kamu minta:*\n` +
    `_"Hapus background foto ini"_\n` +
    `_"Buatkan subtitle video ini"_\n` +
    `_"Jernihkan foto yang blur"_\n` +
    `_"Buat foto ini jadi video cinematic"_\n` +
    `_"Foto saya cocok diedit seperti apa?"_\n\n` +
    `${user.premium
      ? `⭐ Status: *Premium*`
      : `🆓 Kuota hari ini: 💬${user.chatQuota} chat · 📷${user.photoEditQuota} foto · 🎬${user.videoEditQuota} video`
    }\n\n` +
    `_Mulai dengan kirim foto atau video, atau ketik pertanyaanmu!_`,
    { parse_mode: "Markdown" }
  );
}
