import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, addCredits, TOPUP_AMOUNT_IDR, TOPUP_CREDITS } from "../credits";
import { getUserState, setUserState } from "../state";
import { mainKeyboard, getTopUpText } from "./start";

const PAYMENT_BANK    = process.env.PAYMENT_INFO_BANK;
const PAYMENT_EWALLET = process.env.PAYMENT_INFO_EWALLET;
const ADMIN_IDS = () =>
  process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
    : [];

export async function handlePremiumCommand(ctx: Context): Promise<void> {
  return handleTopUp(ctx);
}

export async function handleTopUp(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let paymentInfo = "";
  if (PAYMENT_BANK)    paymentInfo += `🏦 *Transfer Bank:*\n\`${PAYMENT_BANK}\`\n\n`;
  if (PAYMENT_EWALLET) paymentInfo += `📱 *E-Wallet (GoPay/OVO/Dana):*\n\`${PAYMENT_EWALLET}\`\n\n`;
  if (!paymentInfo)    paymentInfo = "📞 Hubungi admin untuk info rekening.\n\n";

  await ctx.reply(
    getTopUpText() + `\n\n${paymentInfo}` +
    `_Setelah transfer, kirim foto/screenshot bukti pembayaran ke chat ini._`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard }
  );

  setUserState(telegramId, { awaitingPaymentProof: true });
}

export async function handlePaymentProof(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name = user.firstName || user.username || `User ${telegramId}`;

  await ctx.reply(
    `✅ *Bukti pembayaran diterima!*\n\n` +
    `Terima kasih ${name}! Admin akan memverifikasi dalam *1×24 jam*.\n` +
    `Setelah dikonfirmasi, *${TOPUP_CREDITS} kredit* akan ditambahkan ke akun kamu. 🙏`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard }
  );

  for (const adminId of ADMIN_IDS()) {
    try {
      await ctx.api.sendMessage(
        adminId,
        `💳 *Permintaan Top Up Baru!*\n\n` +
        `👤 ${name} (@${user.username || "-"})\n` +
        `🆔 ID: \`${telegramId}\`\n` +
        `💰 Nominal: Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} → ${TOPUP_CREDITS} kredit\n\n` +
        `Konfirmasi dengan:\n\`/addcredit ${telegramId} ${TOPUP_CREDITS}\``,
        { parse_mode: "Markdown" }
      );
      if (ctx.message?.photo || ctx.message?.document) {
        await ctx.api.forwardMessage(adminId, telegramId, ctx.message.message_id);
      }
    } catch { /* ignore */ }
  }

  setUserState(telegramId, { awaitingPaymentProof: false });
}

export async function handleAdminApprove(ctx: Context, args: string[]): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId || !ADMIN_IDS().includes(adminId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }
  if (args.length < 1) {
    await ctx.reply("Format: /premium [telegram_id]");
    return;
  }
  const targetId = parseInt(args[0]);
  if (isNaN(targetId)) { await ctx.reply("❌ ID tidak valid."); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  const newStatus = !user.premium;
  await db.update(usersTable).set({ premium: newStatus }).where(eq(usersTable.telegramId, targetId));

  await ctx.reply(
    `✅ User \`${targetId}\` berhasil ${newStatus ? "diupgrade ke ⭐ *Premium*" : "dikembalikan ke 🆓 *Standar*"}`,
    { parse_mode: "Markdown" }
  );

  try {
    await ctx.api.sendMessage(
      targetId,
      newStatus
        ? `🎉 *Selamat! Status kamu diupgrade ke ⭐ Premium!*\n\nTerima kasih sudah mendukung EditAI!`
        : `ℹ️ Status Premium kamu telah berakhir. Ketik /topup untuk top up kredit.`,
      { parse_mode: "Markdown" }
    );
  } catch { /* ignore */ }
}
