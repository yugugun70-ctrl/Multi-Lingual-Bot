import OpenAI from "openai";
import { db, chatHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { EditAction } from "./state";

// Daftar model gratis — dicoba berurutan jika satu kena rate limit
const FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "moonshotai/kimi-k2.6:free",
];

let openrouter: OpenAI | null = null;
if (process.env.OPENROUTER_API_KEY) {
  openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://editai.bot",
      "X-Title": "EditAI Telegram Bot",
    },
  });
}

const SYSTEM_PROMPT = `Kamu adalah EditAI — asisten AI editor foto dan video profesional di Telegram.
Kamu seperti ChatGPT atau Meta AI: bisa ngobrol natural, tidak ada menu tombol, tidak ada pilihan kaku.

KEPRIBADIAN:
- Ramah, santai, profesional — seperti teman yang ahli editing
- Aktif memberi rekomendasi dan inspirasi
- Selalu balas dalam BAHASA YANG SAMA dengan pengguna (default Bahasa Indonesia)
- Jika pengguna tidak mengirim foto/video, tetap jawab pertanyaan mereka dengan normal

FITUR EDITING YANG KAMU BISA:
FOTO: remove_background, upscale_photo, enhance_photo, anime_effect, cartoon_effect, portrait_enhance, color_correction, remove_object, style_transfer
VIDEO: video_upscale, video_stabilize, video_subtitle, video_caption, video_resize, video_watermark, video_noise_reduction
FOTO KE VIDEO: photo_to_video_cinematic, photo_to_video_zoom, photo_to_video_pan

ALUR KERJA NATURAL:
1. Pengguna kirim foto/video TANPA instruksi → tanya ingin diapakan
2. Pengguna jelaskan keinginan → rekomendasikan aksi terbaik, jelaskan singkat, tanya konfirmasi
3. Pengguna konfirmasi (ya/oke/lakukan/gas dll) → set action
4. Pengguna hanya chat/tanya → jawab natural, TIDAK perlu action
5. Instruksi langsung dan jelas ("langsung hapus background") → langsung set action tanpa tanya lagi

CONTOH CHAT NATURAL:
- "Foto saya cocok diedit apa?" → Jawab dengan saran, action: null
- "Tren edit video TikTok?" → Jawab saja, action: null  
- "Hapus background foto ini" → Rekomendasikan remove_background, needs_confirmation: true
- "Oke lakukan" → is_confirmation: true

FORMAT RESPONS (WAJIB JSON VALID, tidak ada teks di luar JSON):
{
  "message": "pesan naturalmu ke pengguna",
  "action": null atau nama action,
  "needs_confirmation": true/false,
  "is_confirmation": true/false,
  "ask_clarification": true/false,
  "extra_params": {}
}

KATA KONFIRMASI: ya, oke, ok, yap, yep, lakukan, jalankan, yes, go, bagus, mantap, setuju, boleh, bisa, silakan, do it, sure, proceed, gas, lanjut, siap, iya`;

export interface AgentResponse {
  message: string;
  action: EditAction | null;
  needsConfirmation: boolean;
  isConfirmation: boolean;
  askClarification: boolean;
  extraParams?: Record<string, string>;
}

async function callWithFallback(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
  if (!openrouter) throw new Error("OpenRouter tidak dikonfigurasi");

  for (const model of FREE_MODELS) {
    try {
      const response = await openrouter.chat.completions.create({
        model,
        max_tokens: 1024,
        messages,
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (text) return text;
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.code === 429;
      if (is429) {
        logger.warn({ model }, "Model rate-limited, coba model berikutnya...");
        continue;
      }
      throw err;
    }
  }
  throw new Error("Semua model gratis sedang rate-limited. Coba lagi sebentar.");
}

export async function runAgent(
  telegramId: number,
  userText: string,
  imageBase64?: string,
  imageMediaType?: string
): Promise<AgentResponse> {
  const history = await db
    .select()
    .from(chatHistoryTable)
    .where(eq(chatHistoryTable.telegramId, telegramId))
    .orderBy(asc(chatHistoryTable.createdAt))
    .limit(20);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
  ];

  let userMessageContent = userText || "[Pengguna mengirim media tanpa pesan]";
  if (imageBase64) {
    userMessageContent = `[Pengguna mengirim foto]${userText ? ` dengan keterangan: "${userText}"` : " tanpa keterangan"}`;
  }
  messages.push({ role: "user", content: userMessageContent });

  let parsed: AgentResponse = {
    message: "Maaf, saya tidak bisa menjawab saat ini. Coba lagi ya!",
    action: null,
    needsConfirmation: false,
    isConfirmation: false,
    askClarification: false,
  };

  if (!openrouter) {
    parsed.message = "⚠️ AI belum dikonfigurasi. Admin perlu menambahkan OPENROUTER_API_KEY di Secrets.";
    return parsed;
  }

  try {
    const rawText = await callWithFallback(messages);

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const raw = JSON.parse(jsonMatch[0]) as {
          message?: string;
          action?: string | null;
          needs_confirmation?: boolean;
          is_confirmation?: boolean;
          ask_clarification?: boolean;
          extra_params?: Record<string, string>;
        };
        parsed = {
          message: raw.message ?? rawText,
          action: (raw.action as EditAction) ?? null,
          needsConfirmation: raw.needs_confirmation ?? false,
          isConfirmation: raw.is_confirmation ?? false,
          askClarification: raw.ask_clarification ?? false,
          extraParams: raw.extra_params,
        };
      } catch {
        parsed.message = rawText;
      }
    } else {
      parsed.message = rawText || parsed.message;
    }

    const historyContent = imageBase64
      ? "[Pengguna mengirim foto/gambar]" + (userText ? ` dengan pesan: "${userText}"` : "")
      : userText;

    await db.insert(chatHistoryTable).values([
      { telegramId, role: "user", content: historyContent },
      { telegramId, role: "assistant", content: parsed.message },
    ]);
  } catch (err: any) {
    logger.error({ err }, "Agent error");
    if (err?.message?.includes("rate-limited")) {
      parsed.message = "⏳ AI sedang sibuk, semua model gratis sedang penuh. Coba lagi dalam 1-2 menit ya!";
    }
  }

  return parsed;
}

export async function clearHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
