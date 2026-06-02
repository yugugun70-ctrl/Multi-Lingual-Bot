import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS
  ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
  : [];

export function isAdmin(telegramId: number): boolean {
  return ADMIN_IDS.includes(telegramId);
}

export async function handleAdminUsers(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) {
    await ctx.reply("❌ Tidak ada akses admin.");
    return;
  }

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

  const [total] = await db.select({ count: count() }).from(usersTable);
  const [premium] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.premium, true));
  const [banned] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.banned, true));

  await ctx.reply(
    `📊 *Statistik Bot:*\n\n` +
    `👥 Total User: *${total.count}*\n` +
    `⭐ Premium: *${premium.count}*\n` +
    `🆓 Gratis: *${total.count - premium.count}*\n` +
    `🚫 Banned: *${banned.count}*`,
    { parse_mode: "Markdown" }
  );
}

export async function handleAddCredit(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 2) { await ctx.reply("Format: /addcredit [id] [jumlah]"); return; }

  const targetId = parseInt(args[0]);
  const amount = parseInt(args[1]);
  if (isNaN(targetId) || isNaN(amount) || amount <= 0) { await ctx.reply("❌ Format tidak valid."); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  await db.update(usersTable).set({ credits: user.credits + amount }).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(`✅ Ditambahkan *${amount}* kredit ke \`${targetId}\`. Total: *${user.credits + amount}*`, { parse_mode: "Markdown" });
}

export async function handleRemoveCredit(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 2) { await ctx.reply("Format: /removecredit [id] [jumlah]"); return; }

  const targetId = parseInt(args[0]);
  const amount = parseInt(args[1]);
  if (isNaN(targetId) || isNaN(amount) || amount <= 0) { await ctx.reply("❌ Format tidak valid."); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  const newCredits = Math.max(0, user.credits - amount);
  await db.update(usersTable).set({ credits: newCredits }).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(`✅ Dikurangi *${amount}* kredit dari \`${targetId}\`. Total: *${newCredits}*`, { parse_mode: "Markdown" });
}

export async function handleBan(ctx: Context, args: string[], ban: boolean): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 1) { await ctx.reply(`Format: /${ban ? "ban" : "unban"} [id]`); return; }

  const targetId = parseInt(args[0]);
  if (isNaN(targetId)) { await ctx.reply("❌ ID tidak valid."); return; }

  await db.update(usersTable).set({ banned: ban }).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(`✅ User \`${targetId}\` ${ban ? "🚫 *diblokir*" : "✅ *dibuka blokirnya*"}`, { parse_mode: "Markdown" });
}

export async function handleBroadcast(ctx: Context, messageText: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (!messageText) { await ctx.reply("Format: /broadcast [pesan]"); return; }

  const users = await db.select({ telegramId: usersTable.telegramId }).from(usersTable).where(eq(usersTable.banned, false));
  await ctx.reply(`📢 Mengirim ke ${users.length} user...`);

  let success = 0; let failed = 0;
  for (const u of users) {
    try {
      await ctx.api.sendMessage(u.telegramId, `📢 *Pengumuman:*\n\n${messageText}`, { parse_mode: "Markdown" });
      success++;
    } catch { failed++; }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`✅ Selesai! Terkirim: ${success} | Gagal: ${failed}`);
}
