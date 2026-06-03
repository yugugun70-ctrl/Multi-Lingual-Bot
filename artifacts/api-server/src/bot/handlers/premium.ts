import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, addCredits, TOPUP_TIERS } from "../credits";
import type { TopupTierKey } from "../credits";
import { getUserState, setUserState } from "../state";
import { mainInlineKeyboard, getTopUpText, topupTiersKeyboard } from "./start";
import { getConfigValue } from "../../lib/config";

function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getAdminIds(): number[] {
  const adminId = getConfigValue("ADMIN_ID");
  const envIds  = process.env.ADMIN_TELEGRAM_IDS;
  const ids: number[] = [];
  if (adminId) ids.push(parseInt(adminId));
  if (envIds) {
    for (const id of envIds.split(",")) {
      const n = parseInt(id.trim());
      if (!isNaN(n) && !ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

export async function handlePremiumCommand(ctx: Context): Promise<void> {
  return handleTopUp(ctx);
}

// Tampilkan pilihan paket
export async function handleTopUp(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await ctx.reply(
    getTopUpText() + `Pilih paket top up:`,
    { parse_mode: "HTML", reply_markup: topupTiersKeyboard() }
  );
}

// User memilih tier tertentu
export async function handleTopUpTier(ctx: Context, tierKey: TopupTierKey): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const tier = TOPUP_TIERS[tierKey];
  setUserState(telegramId, { awaitingPaymentProof: true, topupTier: tierKey });

  await ctx.reply(
    getTopUpText(tierKey),
    { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
  );
}

// User kirim bukti pembayaran
export async function handlePaymentProof(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user     = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  const name     = escHtml(user.firstName || user.username || `User ${telegramId}`);
  const state    = getUserState(telegramId);
  const tierKey  = state.topupTier ?? "starter";
  const tier     = TOPUP_TIERS[tierKey];

  await ctx.reply(
    `✅ <b>Bukti pembayaran diterima!</b>\n\n` +
    `Terima kasih ${name}! Admin akan memverifikasi dalam <b>1×24 jam</b>.\n` +
    `Setelah dikonfirmasi, <b>${tier.credits} kredit</b> akan ditambahkan ke akun kamu. 🙏`,
    { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
  );

  for (const adminId of getAdminIds()) {
    try {
      await ctx.api.sendMessage(
        adminId,
        `💳 <b>Permintaan Top Up Baru!</b>\n\n` +
        `👤 ${name} (@${escHtml(user.username || "-")})\n` +
        `🆔 ID: <code>${telegramId}</code>\n` +
        `📦 Paket: ${tier.label} — Rp ${tier.idr.toLocaleString("id-ID")} → ${tier.credits} kredit\n\n` +
        `Konfirmasi dengan:\n<code>/addcredit ${telegramId} ${tier.credits}</code>`,
        { parse_mode: "HTML" }
      );
      if (ctx.message?.photo || ctx.message?.document) {
        await ctx.api.forwardMessage(adminId, telegramId, ctx.message.message_id);
      }
    } catch { /* ignore jika admin tidak bisa dihubungi */ }
  }

  setUserState(telegramId, { awaitingPaymentProof: false, topupTier: null });
}

export async function handleAdminApprove(ctx: Context, args: string[]): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId || !getAdminIds().includes(adminId)) {
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
    `✅ User <code>${targetId}</code> berhasil ${newStatus ? "diupgrade ke ⭐ <b>Premium</b>" : "dikembalikan ke 🆓 <b>Standar</b>"}`,
    { parse_mode: "HTML" }
  );

  try {
    await ctx.api.sendMessage(
      targetId,
      newStatus
        ? `🎉 <b>Selamat! Status kamu diupgrade ke ⭐ Premium!</b>\n\nTerima kasih sudah mendukung EditAI!`
        : `ℹ️ Status Premium kamu telah berakhir. Ketik /topup untuk top up kredit.`,
      { parse_mode: "HTML" }
    );
  } catch { /* ignore */ }
}
