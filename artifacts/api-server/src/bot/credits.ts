import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db";
import type { EditAction } from "./state";

export const FREE_CHAT_QUOTA = 50;
export const FREE_PHOTO_EDIT_QUOTA = 5;
export const FREE_VIDEO_EDIT_QUOTA = 2;
export const FREE_PHOTO_TO_VIDEO_QUOTA = 1;

export const PREMIUM_CHAT_QUOTA = 500;
export const PREMIUM_PHOTO_EDIT_QUOTA = 50;
export const PREMIUM_VIDEO_EDIT_QUOTA = 20;
export const PREMIUM_PHOTO_TO_VIDEO_QUOTA = 10;

export type QuotaType = "chat" | "photo_edit" | "video_edit" | "photo_to_video";

const PHOTO_EDIT_ACTIONS = new Set<EditAction>([
  "remove_background", "upscale_photo", "enhance_photo", "anime_effect",
  "cartoon_effect", "portrait_enhance", "color_correction", "remove_object", "style_transfer",
]);

const VIDEO_EDIT_ACTIONS = new Set<EditAction>([
  "video_upscale", "video_stabilize", "video_subtitle", "video_caption",
  "video_resize", "video_watermark", "video_noise_reduction",
]);

// Semua aksi video generation (Kling AI) menggunakan kuota photo_to_video
const PHOTO_TO_VIDEO_ACTIONS = new Set<EditAction>([
  "photo_to_video_cinematic", "photo_to_video_zoom", "photo_to_video_pan",
  "image_to_video", "text_to_video",
]);

export function getQuotaTypeForAction(action: EditAction): QuotaType {
  if (PHOTO_EDIT_ACTIONS.has(action)) return "photo_edit";
  if (VIDEO_EDIT_ACTIONS.has(action)) return "video_edit";
  if (PHOTO_TO_VIDEO_ACTIONS.has(action)) return "photo_to_video";
  return "photo_edit";
}

export async function resetDailyQuotaIfNeeded(user: User): Promise<User> {
  const now = new Date();
  const lastReset = new Date(user.lastDailyReset);
  const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    const [updated] = await db
      .update(usersTable)
      .set({
        chatQuota: user.premium ? PREMIUM_CHAT_QUOTA : FREE_CHAT_QUOTA,
        photoEditQuota: user.premium ? PREMIUM_PHOTO_EDIT_QUOTA : FREE_PHOTO_EDIT_QUOTA,
        videoEditQuota: user.premium ? PREMIUM_VIDEO_EDIT_QUOTA : FREE_VIDEO_EDIT_QUOTA,
        photoToVideoQuota: user.premium ? PREMIUM_PHOTO_TO_VIDEO_QUOTA : FREE_PHOTO_TO_VIDEO_QUOTA,
        lastDailyReset: now,
      })
      .where(eq(usersTable.telegramId, user.telegramId))
      .returning();
    return updated;
  }

  return user;
}

export async function deductQuota(
  telegramId: number,
  type: QuotaType
): Promise<{ success: boolean; remaining: number }> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));
  if (!user) return { success: false, remaining: 0 };

  const refreshed = await resetDailyQuotaIfNeeded(user);

  const fieldMap: Record<QuotaType, keyof typeof refreshed> = {
    chat: "chatQuota",
    photo_edit: "photoEditQuota",
    video_edit: "videoEditQuota",
    photo_to_video: "photoToVideoQuota",
  };

  const field = fieldMap[type];
  const current = refreshed[field] as number;

  if (current <= 0) {
    return { success: false, remaining: 0 };
  }

  const [updated] = await db
    .update(usersTable)
    .set({ [field]: current - 1 } as any)
    .where(eq(usersTable.telegramId, telegramId))
    .returning();

  return { success: true, remaining: updated[field] as number };
}

export async function getOrCreateUser(telegramId: number, username?: string, firstName?: string): Promise<User> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId));

  if (existing) {
    return resetDailyQuotaIfNeeded(existing);
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      telegramId,
      username,
      firstName,
      chatQuota: FREE_CHAT_QUOTA,
      photoEditQuota: FREE_PHOTO_EDIT_QUOTA,
      videoEditQuota: FREE_VIDEO_EDIT_QUOTA,
      photoToVideoQuota: FREE_PHOTO_TO_VIDEO_QUOTA,
    })
    .returning();

  return created;
}

export function getQuotaLimitMessage(type: QuotaType): string {
  const messages: Record<QuotaType, string> = {
    chat: `❌ *Kuota chat AI habis!*\n\nKamu sudah mencapai batas 50 pesan hari ini. Reset otomatis dalam 24 jam.\n\nKetik /premium untuk upgrade dan chat tanpa batas! ⭐`,
    photo_edit: `❌ *Kuota edit foto habis!*\n\nKamu sudah menggunakan 5 edit foto hari ini. Reset otomatis dalam 24 jam.\n\nKetik /premium untuk mendapatkan 50 edit foto per hari! ⭐`,
    video_edit: `❌ *Kuota edit video habis!*\n\nKamu sudah menggunakan 2 proses video hari ini. Reset otomatis dalam 24 jam.\n\nKetik /premium untuk mendapatkan 20 proses video per hari! ⭐`,
    photo_to_video: `❌ *Kuota Video Generation habis!*\n\nKamu sudah menggunakan kuota photo/text-to-video hari ini. Reset otomatis dalam 24 jam.\n\nKetik /premium untuk mendapatkan 10 proses per hari! ⭐`,
  };
  return messages[type];
}
