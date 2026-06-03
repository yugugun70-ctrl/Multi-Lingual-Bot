import { pgTable, text, serial, timestamp, boolean, integer, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  premium: boolean("premium").notNull().default(false),
  banned: boolean("banned").notNull().default(false),
  adminId: text("admin_id"),
  registerDate: timestamp("register_date", { withTimezone: true }).notNull().defaultNow(),
  lastDailyReset: timestamp("last_daily_reset", { withTimezone: true }).notNull().defaultNow(),
  // Sistem kredit baru — 1 foto = 1 kredit, 1 video = 3 kredit
  credits: integer("credits").notNull().default(20),
  // Kolom lama dipertahankan agar tidak break — tidak dipakai lagi oleh logika utama
  chatQuota: integer("chat_quota").notNull().default(50),
  photoEditQuota: integer("photo_edit_quota").notNull().default(5),
  videoEditQuota: integer("video_edit_quota").notNull().default(2),
  photoToVideoQuota: integer("photo_to_video_quota").notNull().default(1),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, registerDate: true, lastDailyReset: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
