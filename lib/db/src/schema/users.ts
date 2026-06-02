import { pgTable, text, serial, timestamp, boolean, integer, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  credits: integer("credits").notNull().default(3),
  premium: boolean("premium").notNull().default(false),
  banned: boolean("banned").notNull().default(false),
  adminId: text("admin_id"),
  registerDate: timestamp("register_date", { withTimezone: true }).notNull().defaultNow(),
  lastDailyReset: timestamp("last_daily_reset", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, registerDate: true, lastDailyReset: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
