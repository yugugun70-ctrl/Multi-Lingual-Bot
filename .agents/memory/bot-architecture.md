---
name: Telegram Bot Conversation-First Architecture
description: Bot pakai Claude JSON structured response untuk intent detection, bukan button-driven menu
---

Bot dirancang sebagai Conversation-First (seperti ChatGPT), bukan Menu-Driven.

**Core flow:**
1. Semua pesan masuk → `processMessage()` di `bot/index.ts`
2. `runAgent()` → Claude claude-sonnet-4-6 dengan vision support
3. Claude return JSON: `{message, action, needs_confirmation, is_confirmation, extra_params}`
4. Jika `needs_confirmation: true` → simpan ke in-memory `UserState.pending`
5. User konfirmasi → `executeEditAction()` → Replicate/RemoveBG API
6. Hasil dikirim ke user

**Why:** User experience lebih natural — cukup bicara, tidak perlu pilih menu.

**Key files:**
- `bot/agent.ts` — Claude AI brain dengan vision
- `bot/tools.ts` — editing tools (Replicate, Remove.bg)
- `bot/state.ts` — in-memory user state (Map, cukup untuk single-process)
- `bot/index.ts` — orchestrator utama

**State management:** In-memory Map, upgrade ke Redis jika multi-instance diperlukan.
