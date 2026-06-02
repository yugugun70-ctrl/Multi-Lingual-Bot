# AI Editor Telegram Bot

Bot Telegram berbasis AI yang membantu pengguna mengedit foto dan video menggunakan perintah bahasa alami, dilengkapi sistem kredit, AI chat (Claude), dan panel admin.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — jalankan API server + bot Telegram (port 8080)
- `pnpm run typecheck` — full typecheck semua package
- `pnpm run build` — typecheck + build semua package
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks dan Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema (dev only)
- Required env: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`
- Optional env: `ADMIN_TELEGRAM_IDS` — comma-separated Telegram IDs untuk akses admin

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: Grammy (Telegram Bot Framework)
- AI: Anthropic Claude (claude-haiku-4-5 untuk chat & tren)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle) — grammy di-externalize karena native modules

## Where things live

- `lib/db/src/schema/users.ts` — tabel users (telegramId, credits, premium, banned, dll)
- `lib/db/src/schema/chat_history.ts` — riwayat percakapan AI per user
- `artifacts/api-server/src/bot/` — semua logika bot Telegram
- `artifacts/api-server/src/bot/index.ts` — entry point bot, semua handler terdaftar di sini
- `artifacts/api-server/src/bot/handlers/` — handler per fitur (start, photo, video, chat, admin, dll)
- `artifacts/api-server/src/bot/keyboards.ts` — inline keyboard Telegram
- `artifacts/api-server/src/bot/credits.ts` — sistem kredit & reset harian
- `artifacts/api-server/src/bot/ai.ts` — AI chat dengan riwayat konteks
- `artifacts/api-server/src/bot/trends.ts` — Trend Assistant via Claude

## Architecture decisions

- Grammy di-externalize di esbuild (`build.mjs`) karena memuat `platform.node` secara dinamis — tidak bisa di-bundle.
- Bot berjalan dalam proses yang sama dengan Express server (di `index.ts`) menggunakan long polling.
- Semua pesan teks otomatis diteruskan ke AI chat (kecuali menu button dan perintah `/`).
- Reset kredit harian dilakukan secara lazy saat user berinteraksi, bukan dengan cron job.
- Konteks percakapan AI disimpan di DB (max 20 pesan terakhir per user).

## Product

- Pengguna bisa mengirim foto → pilih fitur editing (jernihkan, hapus bg, anime, dll)
- Pengguna bisa mengirim video → pilih fitur editing (upscale, subtitle, stabilkan, dll)
- AI Chat: chat langsung dengan Claude tentang teknik editing
- Trend Assistant: rekomendasi tren foto/video dari Claude
- Sistem kredit: 3 kredit/hari (gratis), 50 kredit/hari (premium), reset otomatis 24 jam
- Admin panel via perintah bot: /users, /stats, /premium, /addcredit, /removecredit, /broadcast, /ban, /unban

## User preferences

- Bot dan respons dalam Bahasa Indonesia secara default
- Bisa menanggapi bahasa asing jika pengguna menggunakannya

## Gotchas

- Grammy HARUS di-externalize di `build.mjs` — tanpa ini bot crash saat start
- Jangan jalankan `pnpm dev` di root workspace
- Admin IDs diset via env var `ADMIN_TELEGRAM_IDS` (comma-separated), bukan hardcoded
- Setelah update schema DB, selalu jalankan `pnpm --filter @workspace/db run push`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
