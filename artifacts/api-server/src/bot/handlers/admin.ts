import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import type { QuotaType } from "../credits";

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
    text += `  ID: \`${u.telegramId}\`\n`;
    text += `  💬${u.chatQuota} 📷${u.photoEditQuota} 🎬${u.videoEditQuota} 🎞️${u.photoToVideoQuota}\n\n`;
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

export async function handleAddQuota(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 2) { await ctx.reply("Format: /addcredit [id] [jumlah] [chat|photo|video|p2v]\nDefault: chat"); return; }

  const targetId = parseInt(args[0]);
  const amount = parseInt(args[1]);
  const typeArg = args[2] ?? "chat";

  if (isNaN(targetId) || isNaN(amount) || amount <= 0) { await ctx.reply("❌ Format tidak valid."); return; }

  const typeMap: Record<string, keyof typeof usersTable.$inferSelect> = {
    chat: "chatQuota",
    photo: "photoEditQuota",
    video: "videoEditQuota",
    p2v: "photoToVideoQuota",
  };

  const field = typeMap[typeArg];
  if (!field) { await ctx.reply("❌ Tipe tidak valid. Gunakan: chat, photo, video, p2v"); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  const current = user[field] as number;
  await db.update(usersTable).set({ [field]: current + amount } as any).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(`✅ Ditambahkan *${amount}* kuota ${typeArg} ke \`${targetId}\`. Total: *${current + amount}*`, { parse_mode: "Markdown" });
}

export async function handleRemoveQuota(ctx: Context, args: string[]): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isAdmin(telegramId)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 2) { await ctx.reply("Format: /removecredit [id] [jumlah] [chat|photo|video|p2v]\nDefault: chat"); return; }

  const targetId = parseInt(args[0]);
  const amount = parseInt(args[1]);
  const typeArg = args[2] ?? "chat";

  if (isNaN(targetId) || isNaN(amount) || amount <= 0) { await ctx.reply("❌ Format tidak valid."); return; }

  const typeMap: Record<string, keyof typeof usersTable.$inferSelect> = {
    chat: "chatQuota",
    photo: "photoEditQuota",
    video: "videoEditQuota",
    p2v: "photoToVideoQuota",
  };

  const field = typeMap[typeArg];
  if (!field) { await ctx.reply("❌ Tipe tidak valid. Gunakan: chat, photo, video, p2v"); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  const current = user[field] as number;
  const newVal = Math.max(0, current - amount);
  await db.update(usersTable).set({ [field]: newVal } as any).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(`✅ Dikurangi *${amount}* kuota ${typeArg} dari \`${targetId}\`. Total: *${newVal}*`, { parse_mode: "Markdown" });
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
