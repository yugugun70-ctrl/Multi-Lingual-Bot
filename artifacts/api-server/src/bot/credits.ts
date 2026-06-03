import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db";
import type { EditAction } from "./state";

// ─── Konstanta Kredit ─────────────────────────────────────────────────────────
export const NEW_USER_CREDITS   = 50;       // Kredit gratis untuk user baru
export const VIDEO_EDIT_COST    = 5;        // 5 kredit per operasi video

// ─── Paket Top Up ─────────────────────────────────────────────────────────────
export const TOPUP_TIERS = {
  starter: { label: "💡 Starter",  idr: 10_000, credits: 100 },
  value:   { label: "⭐ Value",    idr: 20_000, credits: 250 },
} as const;

export type TopupTierKey = keyof typeof TOPUP_TIERS;

// Kompatibilitas dengan kode lama
export const TOPUP_AMOUNT_IDR = TOPUP_TIERS.starter.idr;
export const TOPUP_CREDITS    = TOPUP_TIERS.starter.credits;

export const CHAT_COST = 0;

export type CreditCost = typeof VIDEO_EDIT_COST | 0;

export function getCreditCost(_action: EditAction): CreditCost {
  return VIDEO_EDIT_COST;
}

// ─── Buat user baru atau ambil yang sudah ada ─────────────────────────────────

export async function getOrCreateUser(
  telegramId: number,
  username?: string,
  firstName?: string
): Promise<User> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));
  if (existing) return existing;

  const [created] = await db
    .insert(usersTable)
    .values({ telegramId, username, firstName, credits: NEW_USER_CREDITS })
    .returning();
  return created;
}

// ─── Cek kredit cukup (TANPA mengurangi) ─────────────────────────────────────

export async function checkCredits(
  telegramId: number,
  cost: CreditCost
): Promise<{ ok: boolean; credits: number }> {
  if (cost === 0) return { ok: true, credits: Infinity };
  const [user] = await db.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.telegramId, telegramId));
  if (!user) return { ok: false, credits: 0 };
  return { ok: user.credits >= cost, credits: user.credits };
}

// ─── Kurangi kredit SETELAH berhasil ─────────────────────────────────────────

export async function deductCredits(
  telegramId: number,
  cost: CreditCost
): Promise<{ success: boolean; remaining: number }> {
  if (cost === 0) return { success: true, remaining: Infinity };

  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));
  if (!user) return { success: false, remaining: 0 };
  if (user.credits < cost) return { success: false, remaining: user.credits };

  const newCredits = Math.max(0, user.credits - cost);
  const [updated] = await db
    .update(usersTable)
    .set({ credits: newCredits })
    .where(eq(usersTable.telegramId, telegramId))
    .returning({ credits: usersTable.credits });

  return { success: true, remaining: updated.credits };
}

// ─── Tambah kredit (top up / admin) ──────────────────────────────────────────

export async function addCredits(
  telegramId: number,
  amount: number
): Promise<{ credits: number }> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));
  if (!user) return { credits: 0 };

  const newCredits = user.credits + amount;
  const [updated] = await db
    .update(usersTable)
    .set({ credits: newCredits })
    .where(eq(usersTable.telegramId, telegramId))
    .returning({ credits: usersTable.credits });

  return { credits: updated.credits };
}

// ─── Pesan error kredit habis ─────────────────────────────────────────────────

export function getCreditErrorMessage(cost: CreditCost, currentCredits: number): string {
  return (
    `❌ <b>Kredit tidak cukup!</b>\n\n` +
    `Aksi ini butuh <b>${cost} kredit</b>, kamu punya <b>${currentCredits} kredit</b>.\n\n` +
    `💳 <b>Pilihan Top Up:</b>\n` +
    `• Rp 10.000 → <b>100 kredit</b>\n` +
    `• Rp 20.000 → <b>250 kredit</b>\n\n` +
    `Ketik /topup untuk top up.`
  );
}
