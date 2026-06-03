import type { Context } from "grammy";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser } from "../credits";
import { mainInlineKeyboard } from "./start";

// Hadiah check-in harian
const DAILY_REWARD = 2;       // kredit per hari
const STREAK_BONUS_DAY = 7;   // hari ke-7
const STREAK_BONUS = 10;      // bonus kredit di hari ke-7

function todayDate(): string {
  return new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
}

function yesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export async function handleCheckin(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user  = await getOrCreateUser(telegramId, ctx.from?.username, ctx.from?.first_name);
  if (user.banned) { await ctx.reply("Akun kamu diblokir."); return; }

  const today     = todayDate();
  const yesterday = yesterdayDate();
  const lastCi    = user.lastCheckin as string | null;

  // Sudah check-in hari ini
  if (lastCi === today) {
    const nextStreak = user.checkinStreak % STREAK_BONUS_DAY;
    const daysLeft   = STREAK_BONUS_DAY - nextStreak;
    await ctx.reply(
      `✅ <b>Sudah check-in hari ini!</b>\n\n` +
      `🔥 Streak: <b>${user.checkinStreak} hari</b>\n` +
      `💳 Kredit: <b>${user.credits} kredit</b>\n\n` +
      `🎁 Bonus streak hari ke-7 tersisa <b>${daysLeft} hari</b> lagi!\n` +
      `Kembali besok untuk melanjutkan streak-mu.`,
      { parse_mode: "HTML", reply_markup: mainInlineKeyboard() }
    );
    return;
  }

  // Hitung streak baru
  const newStreak = lastCi === yesterday ? user.checkinStreak + 1 : 1;
  const isStreakBonus = newStreak % STREAK_BONUS_DAY === 0;
  const reward   = DAILY_REWARD + (isStreakBonus ? STREAK_BONUS : 0);
  const newCredits = user.credits + reward;

  await db
    .update(usersTable)
    .set({
      credits: newCredits,
      lastCheckin: today,
      checkinStreak: newStreak,
    })
    .where(eq(usersTable.telegramId, telegramId));

  const streakBar = buildStreakBar(newStreak);
  const daysToBonus = STREAK_BONUS_DAY - (newStreak % STREAK_BONUS_DAY);

  let msg = `🎉 <b>Check-in Berhasil!</b>\n\n`;
  if (isStreakBonus) {
    msg += `🏆 <b>SELAMAT! Streak 7 hari tercapai!</b>\n`;
    msg += `🎁 Bonus +${STREAK_BONUS} kredit ekstra!\n\n`;
  }
  msg += `+${reward} kredit | Total: <b>${newCredits} kredit</b>\n\n`;
  msg += `${streakBar}\n`;
  msg += `🔥 Streak: <b>${newStreak} hari</b>`;
  if (!isStreakBonus) {
    msg += ` (<b>${daysToBonus} hari</b> lagi untuk bonus 🎁)`;
  } else {
    msg += ` — streak direset, mulai lagi!`;
  }
  msg += `\n\nKembali besok untuk menjaga streak-mu!`;

  await ctx.reply(msg, { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
}

function buildStreakBar(streak: number): string {
  const pos = streak % STREAK_BONUS_DAY || STREAK_BONUS_DAY;
  const days: string[] = [];
  for (let i = 1; i <= STREAK_BONUS_DAY; i++) {
    if (i < pos)       days.push("✅");
    else if (i === pos) days.push("🔥");
    else if (i === STREAK_BONUS_DAY) days.push("🎁");
    else               days.push("⬜");
  }
  return days.join(" ");
}
