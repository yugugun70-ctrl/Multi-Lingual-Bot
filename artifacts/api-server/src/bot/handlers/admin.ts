import type { Context } from "grammy";
import { InputFile } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { addCredits } from "../credits";

const ADMIN_IDS = () =>
  process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
    : [];

export function isAdmin(telegramId: number): boolean {
  return ADMIN_IDS().includes(telegramId);
}

export async function handleAdminUsers(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  const users = await db.select().from(usersTable).limit(20);
  let text = `👥 *Daftar User (20 terbaru):*\n\n`;
  for (const u of users) {
    const name = u.firstName || u.username || "Unknown";
    const status = u.premium ? "⭐" : "🆓";
    const banned = u.banned ? " 🚫" : "";
    text += `${status}${banned} *${name}* (@${u.username || "-"})\n`;
    text += `  ID: \`${u.telegramId}\` | 💳 ${u.credits} kredit\n\n`;
  }
  await ctx.reply(text, { parse_mode: "Markdown" });
}

export async function handleAdminStats(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) return;
  const [total]   = await db.select({ count: count() }).from(usersTable);
  const [premium] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.premium, true));
  const [banned]  = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.banned, true));
  await ctx.reply(
    `📊 *Statistik Bot:*\n\n` +
    `👥 Total User: *${total.count}*\n` +
    `⭐ Premium: *${premium.count}*\n` +
    `🆓 Standar: *${total.count - premium.count}*\n` +
    `🚫 Banned: *${banned.count}*`,
    { parse_mode: "Markdown" }
  );
}

export async function handleAddQuota(ctx: Context, args: string[]): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 2) { await ctx.reply("Format: /addcredit [id] [jumlah]"); return; }

  const targetId = parseInt(args[0]);
  const amount   = parseInt(args[1]);
  if (isNaN(targetId) || isNaN(amount) || amount <= 0) { await ctx.reply("❌ Format tidak valid."); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  const { credits } = await addCredits(targetId, amount);
  await ctx.reply(
    `✅ Ditambahkan *${amount} kredit* ke \`${targetId}\`.\nTotal sekarang: *${credits} kredit*`,
    { parse_mode: "Markdown" }
  );

  // Notifikasi ke user
  try {
    await ctx.api.sendMessage(
      targetId,
      `💳 *Top Up Berhasil!*\n\n*+${amount} kredit* telah ditambahkan ke akunmu.\nSaldo sekarang: *${credits} kredit*\n\nTerima kasih! 🙏`,
      { parse_mode: "Markdown" }
    );
  } catch { /* ignore */ }
}

export async function handleRemoveQuota(ctx: Context, args: string[]): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 2) { await ctx.reply("Format: /removecredit [id] [jumlah]"); return; }

  const targetId = parseInt(args[0]);
  const amount   = parseInt(args[1]);
  if (isNaN(targetId) || isNaN(amount) || amount <= 0) { await ctx.reply("❌ Format tidak valid."); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, targetId));
  if (!user) { await ctx.reply("❌ User tidak ditemukan."); return; }

  const newVal = Math.max(0, user.credits - amount);
  await db.update(usersTable).set({ credits: newVal }).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(
    `✅ Dikurangi *${amount} kredit* dari \`${targetId}\`. Total: *${newVal} kredit*`,
    { parse_mode: "Markdown" }
  );
}

export async function handleBan(ctx: Context, args: string[], ban: boolean): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (args.length < 1) { await ctx.reply(`Format: /${ban ? "ban" : "unban"} [id]`); return; }
  const targetId = parseInt(args[0]);
  if (isNaN(targetId)) { await ctx.reply("❌ ID tidak valid."); return; }
  await db.update(usersTable).set({ banned: ban }).where(eq(usersTable.telegramId, targetId));
  await ctx.reply(`✅ User \`${targetId}\` ${ban ? "🚫 *diblokir*" : "✅ *dibuka blokirnya*"}`, { parse_mode: "Markdown" });
}

export async function handleBroadcast(ctx: Context, messageText: string): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) { await ctx.reply("❌ Tidak ada akses admin."); return; }
  if (!messageText) { await ctx.reply("Format: /broadcast [pesan]"); return; }

  const users = await db.select({ telegramId: usersTable.telegramId }).from(usersTable).where(eq(usersTable.banned, false));
  await ctx.reply(`📢 Mengirim ke ${users.length} user...`);

  let success = 0, failed = 0;
  for (const u of users) {
    try {
      await ctx.api.sendMessage(u.telegramId, `📢 *Pengumuman:*\n\n${messageText}`, { parse_mode: "Markdown" });
      success++;
    } catch { failed++; }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`✅ Selesai! Terkirim: ${success} | Gagal: ${failed}`);
}

// ─── /teststatus — Diagnostik sistem ─────────────────────────────────────────

export async function handleTestStatus(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id ?? 0)) { await ctx.reply("❌ Tidak ada akses admin."); return; }

  await ctx.reply("🔍 Menjalankan diagnostik sistem...");
  const results: string[] = [];

  // 1. Sharp
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const sharp = req("sharp");
    const base = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 50, g: 130, b: 200 } } }).jpeg().toBuffer();
    const upBuf = await sharp(base).resize(1200, 1200, { kernel: "lanczos3" }).sharpen({ sigma: 1 }).jpeg({ quality: 92 }).toBuffer();
    results.push(`✅ Sharp upscale — ${(upBuf.length / 1024).toFixed(0)} KB`);
    await ctx.replyWithPhoto(new InputFile(upBuf, "test_upscale.jpg"), { caption: "🔬 Test: Sharp upscale 3x" });
  } catch (e: any) { results.push(`❌ Sharp — ${e.message?.slice(0, 60)}`); }

  // 2. imgly
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const imgly = req("@imgly/background-removal-node");
    results.push(`✅ imgly — exports: ${Object.keys(imgly).join(", ")}`);
  } catch (e: any) { results.push(`❌ imgly — ${e.message?.slice(0, 60)}`); }

  // 3. FFmpeg photo-to-video (5s preview)
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    const { readFile, unlink } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const outPath = path.join(os.tmpdir(), `teststatus_ptv_${Date.now()}.mp4`);
    await execAsync(
      `ffmpeg -y -f lavfi -i "color=c=0x1a2a4a:size=1920x1080:duration=5" ` +
      `-vf "zoompan=z='min(zoom+0.001,1.3)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30" ` +
      `-t 5 -c:v libx264 -crf 16 -preset fast -pix_fmt yuv420p "${outPath}"`,
      { timeout: 60000 }
    );
    const buf = await readFile(outPath);
    await unlink(outPath).catch(() => {});
    results.push(`✅ FFmpeg photo-to-video (5s) — ${(buf.length / 1024).toFixed(0)} KB`);
    await ctx.replyWithVideo(new InputFile(buf, "test_ptv.mp4"), { caption: "🎬 Test: Ken Burns 5s", supports_streaming: true });
  } catch (e: any) { results.push(`❌ FFmpeg photo-to-video — ${e.message?.slice(0, 80)}`); }

  // 4. FFmpeg enhance
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    const { readFile, unlink } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const outPath = path.join(os.tmpdir(), `teststatus_enh_${Date.now()}.mp4`);
    await execAsync(
      `ffmpeg -y -f lavfi -i "color=c=0x2a4a2a:size=1280x720:duration=3" ` +
      `-vf "hqdn3d=2:1.5:3:2.5,unsharp=5:5:1.2,eq=contrast=1.05:saturation=1.15" ` +
      `-t 3 -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p "${outPath}"`,
      { timeout: 60000 }
    );
    const buf = await readFile(outPath);
    await unlink(outPath).catch(() => {});
    results.push(`✅ FFmpeg video enhance — ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (e: any) { results.push(`❌ FFmpeg enhance — ${e.message?.slice(0, 80)}`); }

  // 5. NVIDIA NIM
  try {
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (!nvidiaKey) throw new Error("NVIDIA_API_KEY tidak ada");
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${nvidiaKey}` },
      body: JSON.stringify({ model: "nvidia/llama-3.1-nemotron-nano-8b-v1", messages: [{ role: "user", content: "Reply: OK" }], max_tokens: 5 }),
    });
    results.push(res.ok ? `✅ NVIDIA NIM — HTTP ${res.status}` : `⚠️ NVIDIA NIM — HTTP ${res.status}`);
  } catch (e: any) { results.push(`❌ NVIDIA NIM — ${e.message?.slice(0, 60)}`); }

  // 6. Kling AI
  try {
    const ak = process.env.KLING_ACCESS_KEY;
    const sk = process.env.KLING_SECRET_KEY;
    if (!ak || !sk) throw new Error("KLING keys tidak diset");
    const { createHmac } = await import("node:crypto");
    const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: ak, exp: Math.floor(Date.now() / 1000) + 1800, nbf: Math.floor(Date.now() / 1000) - 5 })).toString("base64url");
    const sig     = createHmac("sha256", sk).update(`${header}.${payload}`).digest("base64url");
    const token   = `${header}.${payload}.${sig}`;
    results.push(token.length > 20 ? `✅ Kling AI — JWT OK (${token.length} chars)` : `❌ Kling AI — JWT gagal`);
  } catch (e: any) { results.push(`❌ Kling AI — ${String(e.message ?? e).slice(0, 60)}`); }

  const passed = results.filter(r => r.startsWith("✅")).length;
  const warn   = results.filter(r => r.startsWith("⚠️")).length;
  const failed = results.filter(r => r.startsWith("❌")).length;

  await ctx.reply(
    `📊 *Hasil Diagnostik EditAI:*\n\n` +
    results.map(r => `  ${r}`).join("\n") +
    `\n\n✅ ${passed} OK  ⚠️ ${warn} Peringatan  ❌ ${failed} Gagal`,
    { parse_mode: "Markdown" }
  );
}
