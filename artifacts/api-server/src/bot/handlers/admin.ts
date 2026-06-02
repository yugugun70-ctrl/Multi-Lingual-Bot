import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import { adminKeyboard } from "../keyboards";

const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS
  ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
  : [];

export function isAdmin(telegramId: number): boolean {
  return ADMIN_IDS.includes(telegramId);
}

export async function handleAdminPanel(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
    await ctx.reply("❌ Kamu tidak memiliki akses admin.");
    return;
  }

  await ctx.reply(
    `🔐 *Panel Admin*\n\nSelamat datang di panel admin EditAI Bot.`,
    { parse_mode: "Markdown", reply_markup: adminKeyboard() }
  );
}

export async function handleAdminUsers(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) return;

  const users = await db.select().from(usersTable).limit(20);
  let text = `👥 *Daftar User (20 terbaru):*\n\n`;

  for (const u of users) {
    const name = u.firstName || u.username || "Unknown";
    const status = u.premium ? "⭐" : "🆓";
    const banned = u.banned ? " 🚫" : "";
    text += `${status}${banned} *${name}* (@${u.username || "-"})\n`;
    text += `  ID: \`${u.telegramId}\` | Kredit: ${u.credits}\n\n`;
  }

  await ctx.reply(text, { parse_mode: "Markdown" });
}

export async function handleAdminStats(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) return;

  const [totalResult] = await db.select({ count: count() }).from(usersTable);
  const [premiumResult] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(eq(usersTable.premium, true));
  const [bannedResult] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(eq(usersTable.banned, true));

  await ctx.reply(
    `📊 *Statistik Bot:*\n\n` +
    `👥 Total User: *${totalResult.count}*\n` +
    `⭐ User Premium: *${premiumResult.count}*\n` +
    `🆓 User Gratis: *${totalResult.count - premiumResult.count}*\n` +
    `🚫 User Banned: *${bannedResult.count}*`,
    { parse_mode: "Markdown" }
  );
}

export async function handleAddCredit(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }

  if (args.length < 2) {
    await ctx.reply("Format: /addcredit [telegram_id] [jumlah]\nContoh: /addcredit 123456789 10");
    return;
  }

  const targetId = parseInt(args[0]);
  const amount = parseInt(args[1]);

  if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
    await ctx.reply("❌ Format tidak valid. Masukkan ID dan jumlah yang benar.");
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) {
    await ctx.reply("❌ User tidak ditemukan.");
    return;
  }

  await db
    .update(usersTable)
    .set({ credits: user.credits + amount })
    .where(eq(usersTable.telegramId, targetId));

  await ctx.reply(`✅ Berhasil menambahkan *${amount}* kredit ke user \`${targetId}\`.\nTotal kredit sekarang: *${user.credits + amount}*`, { parse_mode: "Markdown" });
}

export async function handleRemoveCredit(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }

  if (args.length < 2) {
    await ctx.reply("Format: /removecredit [telegram_id] [jumlah]\nContoh: /removecredit 123456789 5");
    return;
  }

  const targetId = parseInt(args[0]);
  const amount = parseInt(args[1]);

  if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
    await ctx.reply("❌ Format tidak valid.");
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) {
    await ctx.reply("❌ User tidak ditemukan.");
    return;
  }

  const newCredits = Math.max(0, user.credits - amount);
  await db
    .update(usersTable)
    .set({ credits: newCredits })
    .where(eq(usersTable.telegramId, targetId));

  await ctx.reply(`✅ Berhasil mengurangi *${amount}* kredit dari user \`${targetId}\`.\nTotal kredit sekarang: *${newCredits}*`, { parse_mode: "Markdown" });
}

export async function handleSetPremium(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
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
    .set({ premium: newStatus, credits: newStatus ? 50 : 3 })
    .where(eq(usersTable.telegramId, targetId));

  await ctx.reply(
    `✅ Status user \`${targetId}\` berhasil diubah ke *${newStatus ? "⭐ Premium" : "🆓 Gratis"}*`,
    { parse_mode: "Markdown" }
  );
}

export async function handleBan(ctx: Context, args: string[], ban: boolean): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }

  if (args.length < 1) {
    const cmd = ban ? "/ban" : "/unban";
    await ctx.reply(`Format: ${cmd} [telegram_id]`);
    return;
  }

  const targetId = parseInt(args[0]);
  if (isNaN(targetId)) {
    await ctx.reply("❌ ID tidak valid.");
    return;
  }

  await db
    .update(usersTable)
    .set({ banned: ban })
    .where(eq(usersTable.telegramId, targetId));

  await ctx.reply(
    `✅ User \`${targetId}\` berhasil ${ban ? "🚫 *diblokir*" : "✅ *dibuka blokirnya*"}`,
    { parse_mode: "Markdown" }
  );
}

export async function handleBroadcast(ctx: Context, messageText: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }

  if (!messageText) {
    await ctx.reply("Format: /broadcast [pesan]\nContoh: /broadcast Halo semua! Bot sudah diupdate.");
    return;
  }

  const users = await db.select({ telegramId: usersTable.telegramId }).from(usersTable).where(eq(usersTable.banned, false));

  await ctx.reply(`📢 Mengirim broadcast ke ${users.length} user...`);

  let success = 0;
  let failed = 0;

  for (const u of users) {
    try {
      await ctx.api.sendMessage(
        u.telegramId,
        `📢 *Pengumuman dari Admin:*\n\n${messageText}`,
        { parse_mode: "Markdown" }
      );
      success++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  await ctx.reply(`✅ Broadcast selesai!\n✓ Terkirim: ${success}\n✗ Gagal: ${failed}`);
}
