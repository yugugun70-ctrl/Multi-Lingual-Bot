import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Migrasi otomatis saat startup — buat tabel jika belum ada, lalu apply perubahan
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Buat tabel users jika belum ada (migrasi awal)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL UNIQUE,
        username TEXT,
        first_name TEXT,
        premium BOOLEAN NOT NULL DEFAULT FALSE,
        banned BOOLEAN NOT NULL DEFAULT FALSE,
        admin_id TEXT,
        register_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_daily_reset TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        credits INTEGER NOT NULL DEFAULT 20,
        chat_quota INTEGER NOT NULL DEFAULT 50,
        photo_edit_quota INTEGER NOT NULL DEFAULT 5,
        video_edit_quota INTEGER NOT NULL DEFAULT 2,
        photo_to_video_quota INTEGER NOT NULL DEFAULT 1
      );
    `);

    // Buat tabel chat_history jika belum ada
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Tambah kolom credits jika belum ada (untuk DB lama)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 20;
    `);

    // User lama yang credits-nya masih 0 → berikan 20 gratis
    await client.query(`UPDATE users SET credits = 20 WHERE credits = 0;`);

    console.log("[DB] Migrasi selesai ✓");
  } catch (err) {
    console.warn("[DB] Migration warning:", err);
  } finally {
    client.release();
  }
}

export * from "./schema";
