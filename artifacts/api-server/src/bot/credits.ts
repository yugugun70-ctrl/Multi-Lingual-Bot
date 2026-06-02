import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db";

export const FREE_DAILY_CREDITS = 3;
export const PREMIUM_DAILY_CREDITS = 50;

export async function resetDailyCreditsIfNeeded(user: User): Promise<User> {
  const now = new Date();
  const lastReset = new Date(user.lastDailyReset);
  const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    const dailyCredits = user.premium ? PREMIUM_DAILY_CREDITS : FREE_DAILY_CREDITS;
    const [updated] = await db
      .update(usersTable)
      .set({ credits: dailyCredits, lastDailyReset: now })
      .where(eq(usersTable.telegramId, user.telegramId))
      .returning();
    return updated;
  }

  return user;
}

export async function deductCredit(telegramId: number): Promise<{ success: boolean; remaining: number }> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));
  if (!user) return { success: false, remaining: 0 };

  const refreshed = await resetDailyCreditsIfNeeded(user);

  if (refreshed.credits <= 0) {
    return { success: false, remaining: 0 };
  }

  const [updated] = await db
    .update(usersTable)
    .set({ credits: refreshed.credits - 1 })
    .where(eq(usersTable.telegramId, telegramId))
    .returning();

  return { success: true, remaining: updated.credits };
}

export async function getOrCreateUser(telegramId: number, username?: string, firstName?: string): Promise<User> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));

  if (existing) {
    return resetDailyCreditsIfNeeded(existing);
  }

  const [created] = await db
    .insert(usersTable)
    .values({ telegramId, username, firstName, credits: FREE_DAILY_CREDITS })
    .returning();

  return created;
}
