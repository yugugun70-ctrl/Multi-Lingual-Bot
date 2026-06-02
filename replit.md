# AI Editor Telegram Bot

Bot Telegram berbasis AI yang bekerja seperti ChatGPT — pengguna cukup kirim foto/video dan bicara natural, bot memahami maksud dan menjalankan edit secara otomatis.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — jalankan API server + bot Telegram (port 8080)
- `pnpm run typecheck` — full typecheck semua package
- `pnpm --filter @workspace/db run push` — push DB schema changes
- Required env: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `ADMIN_TELEGRAM_IDS`
- Optional env: `REPLICATE_API_TOKEN`, `REMOVE_BG_API_KEY`, `PAYMENT_INFO_BANK`, `PAYMENT_INFO_EWALLET`, `PREMIUM_PRICE`, `PREMIUM_DURATION_DAYS`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: Grammy (Telegram Bot Framework) — di-externalize di esbuild karena native modules
- AI: Anthropic Claude claude-sonnet-4-6 (AI agent + vision analisis foto)
- Editing: Replicate API + Remove.bg API
- DB: PostgreSQL + Drizzle ORM
- Build: esbuild (grammy harus external)

## Architecture: Conversation-First

Bot bekerja seperti ChatGPT — BUKAN menu-driven:
1. User kirim pesan/foto/video → `processMessage()` di `bot/index.ts`
2. `runAgent()` di `bot/agent.ts` → Claude dengan vision menganalisis + menentukan intent
3. Claude return JSON: `{message, action, needs_confirmation, is_confirmation, extra_params}`
4. Jika `needs_confirmation: true` → simpan ke `UserState.pending`, tunggu konfirmasi user
5. User konfirmasi (ya/oke/lakukan/dll) → `executeEditAction()` di `bot/tools.ts`
6. Hasil dikirim ke user

## Where things live

- `lib/db/src/schema/users.ts` — tabel users (telegramId, credits, premium, banned, dll)
- `lib/db/src/schema/chat_history.ts` — riwayat percakapan AI per user
- `artifacts/api-server/src/bot/index.ts` — orchestrator utama bot (routing semua pesan)
- `artifacts/api-server/src/bot/agent.ts` — AI brain (Claude + vision, return JSON intent)
- `artifacts/api-server/src/bot/tools.ts` — semua editing tools (Replicate, Remove.bg)
- `artifacts/api-server/src/bot/state.ts` — in-memory user state (pending edits, file IDs)
- `artifacts/api-server/src/bot/credits.ts` — sistem kredit & reset harian
- `artifacts/api-server/src/bot/handlers/` — start, akun, kredit, premium, admin

## Commands

Hanya 5 command user-facing:
- `/start` — sambutan
- `/akun` — info profil
- `/kredit` — cek kredit
- `/premium` — upgrade / (admin) toggle premium user
- `/help` — panduan
- `/reset` — reset riwayat percakapan

Admin only: `/users`, `/stats`, `/addcredit`, `/removecredit`, `/broadcast`, `/ban`, `/unban`

## Premium Payment Flow

1. User ketik `/premium` → bot tampilkan harga + info rekening (dari env vars)
2. User transfer → kirim foto bukti ke bot
3. Bot forward bukti ke semua admin (dari `ADMIN_TELEGRAM_IDS`)
4. Admin jalankan `/premium [telegram_id]` → akun langsung aktif Premium
5. Bot notifikasi user bahwa Premium sudah aktif

## Architecture Decisions

- Grammy HARUS di-externalize di `build.mjs` — tanpa ini crash saat startup
- Conversation state disimpan in-memory (Map) — cukup untuk single-process, upgrade ke Redis jika multi-instance
- Riwayat chat disimpan di DB (max 30 pesan), foto didownload sebagai base64 untuk Claude vision
- Reset kredit dilakukan lazy saat user berinteraksi (bukan cron job)
- Claude return JSON structured response untuk intent detection yang reliable

## User Preferences

- Bot dan respons dalam Bahasa Indonesia secara default
- Bisa menanggapi bahasa asing jika pengguna menggunakannya
- Arsitektur Conversation-First — TIDAK ada menu tombol berlebihan

## Gotchas

- Grammy HARUS di-externalize di `build.mjs`
- Setelah update schema DB, jalankan `pnpm --filter @workspace/db run push`
- Replicate API bisa lambat (30-180 detik) — normal untuk AI processing
- Foto didownload dari Telegram API untuk dikirim ke Claude vision — butuh TELEGRAM_BOT_TOKEN saat runtime
