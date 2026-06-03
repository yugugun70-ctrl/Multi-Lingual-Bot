import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db";
import type { EditAction } from "./state";

// ─── Konstanta Kredit ─────────────────────────────────────────────────────────
export const NEW_USER_CREDITS = 20;         // Kredit gratis untuk user baru
export const PHOTO_EDIT_COST = 1;           // 1 kredit per edit foto
export const VIDEO_EDIT_COST = 3;           // 3 kredit per edit/buat video
export const TOPUP_AMOUNT_IDR = 15000;      // Rp 15.000
export const TOPUP_CREDITS = 100;           // = 100 kredit

// Chat AI GRATIS — tidak mengurangi kredit sama sekali
export const CHAT_COST = 0;

export type CreditCost = typeof PHOTO_EDIT_COST | typeof VIDEO_EDIT_COST | 0;

const PHOTO_ACTIONS = new Set<EditAction>([
  "remove_background", "upscale_photo", "enhance_photo", "anime_effect",
  "cartoon_effect", "portrait_enhance", "color_correction", "remove_object", "style_transfer",
]);

const VIDEO_ACTIONS = new Set<EditAction>([
  "video_upscale", "video_enhance", "video_stabilize", "video_subtitle",
  "video_caption", "video_resize", "video_watermark", "video_noise_reduction",
  "photo_to_video_cinematic", "photo_to_video_zoom", "photo_to_video_pan",
  "image_to_video", "text_to_video",
]);

export function getCreditCost(action: EditAction): CreditCost {
  if (PHOTO_ACTIONS.has(action)) return PHOTO_EDIT_COST;
  if (VIDEO_ACTIONS.has(action)) return VIDEO_EDIT_COST;
  return PHOTO_EDIT_COST;
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
  const label = cost === VIDEO_EDIT_COST ? "video" : "foto";
  return (
    `❌ *Kredit tidak cukup!*\n\n` +
    `Aksi ini membutuhkan *${cost} kredit* (${label}), tapi kamu hanya punya *${currentCredits} kredit*.\n\n` +
    `💳 Top up kredit:\n` +
    `Rp ${TOPUP_AMOUNT_IDR.toLocaleString("id-ID")} → *${TOPUP_CREDITS} kredit*\n\n` +
    `Ketik /topup atau tekan tombol *💳 Top Up Credit* untuk top up.`
  );
}

// ─── Compat: fungsi lama (masih dipakai beberapa file) ────────────────────────
// @deprecated Gunakan checkCredits + deductCredits
export type QuotaType = "chat" | "photo_edit" | "video_edit" | "photo_to_video";

export function getQuotaTypeForAction(action: EditAction): QuotaType {
  if (["remove_background","upscale_photo","enhance_photo","anime_effect","cartoon_effect","portrait_enhance","color_correction","remove_object","style_transfer"].includes(action)) return "photo_edit";
  if (["video_upscale","video_enhance","video_stabilize","video_subtitle","video_caption","video_resize","video_watermark","video_noise_reduction"].includes(action)) return "video_edit";
  return "photo_to_video";
}

export function getQuotaLimitMessage(type: QuotaType): string {
  return `❌ Kredit tidak cukup untuk aksi ini. Tekan *💳 Top Up Credit* untuk top up.`;
}

export const FREE_CHAT_QUOTA = 50;
export const FREE_PHOTO_EDIT_QUOTA = 5;
export const FREE_VIDEO_EDIT_QUOTA = 2;
export const FREE_PHOTO_TO_VIDEO_QUOTA = 1;
export const PREMIUM_CHAT_QUOTA = 500;
export const PREMIUM_PHOTO_EDIT_QUOTA = 50;
export const PREMIUM_VIDEO_EDIT_QUOTA = 20;
export const PREMIUM_PHOTO_TO_VIDEO_QUOTA = 10;
