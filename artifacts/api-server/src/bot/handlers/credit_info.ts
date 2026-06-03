import type { Context } from "grammy";
import { getOrCreateUser, PHOTO_EDIT_COST, VIDEO_EDIT_COST, TOPUP_AMOUNT_IDR, TOPUP_CREDITS } from "../credits";
import { mainKeyboard } from "./start";

export async function handleCreditInfo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);

  await ctx.reply(
    `💳 *Kredit Kamu*\n\n` +
    `💰 Saldo: *${user.credits} kredit*\n\n` +
    `📋 *Tarif:*\n` +
    `📷 Edit Foto → *${PHOTO_EDIT_COST} kredit*\n` +
    `🎞️ Foto → Video → *${VIDEO_EDIT_COST} kredit*\n` +
    `🖼️ Teks → Foto → *${VIDEO_EDIT_COST} kredit*\n` +
    `✨ Jernihkan Video → *${VIDEO_EDIT_COST} kredit*\n` +
    `💬 Chat AI → *GRATIS* ♾️\n\n` +
    `💡 *Catatan:* Kredit hanya dipotong jika produksi *berhasil*. Jika gagal, kredit tidak berkurang.\n\n` +
    `💳 *Top Up:* Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} = *${TOPUP_CREDITS} kredit*\n` +
    `Tekan tombol *💳 Top Up Credit* untuk top up.`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard }
  );
}

export async function handleAkunInfo(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || "-";
  const joined = new Date(user.registerDate).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });

  await ctx.reply(
    `👤 *Profil Akun*\n\n` +
    `Nama: *${name}*\n` +
    `Username: @${user.username || "-"}\n` +
    `ID: \`${user.telegramId}\`\n` +
    `Status: ${user.premium ? "⭐ Premium" : "🆓 Standar"}\n` +
    `Bergabung: ${joined}\n\n` +
    `💳 *Saldo Kredit: ${user.credits} kredit*\n\n` +
    `📷 Edit Foto = 1 kredit\n` +
    `🎞️ Edit/Buat Video = 3 kredit\n` +
    `💬 Chat AI = GRATIS`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard }
  );
}
