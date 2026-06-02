import OpenAI from "openai";
import { db, chatHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { EditAction } from "./state";

// NVIDIA NIM API — AI utama untuk chat, coding, vision, OCR, analisis dokumen
let nvidiaClient: OpenAI | null = null;
if (process.env.NVIDIA_API_KEY) {
  nvidiaClient = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
}

// Model NVIDIA NIM — terverifikasi aktif di akun ini
const NVIDIA_VISION_MODEL = "meta/llama-3.2-11b-vision-instruct";       // Vision: analisis gambar/OCR/dokumen
const NVIDIA_TEXT_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1";     // Chat + coding + reasoning (Nemotron)
const NVIDIA_FALLBACK_MODEL = "nvidia/llama-3.1-nemotron-nano-8b-v1";   // Fallback ringan (Nemotron Nano)
const NVIDIA_FALLBACK2_MODEL = "meta/llama-3.3-70b-instruct";           // Fallback kedua (Meta Llama)

const SYSTEM_PROMPT = `Kamu adalah EditAI — asisten AI editor foto dan video profesional di Telegram.
Kamu seperti ChatGPT atau Meta AI: bisa ngobrol natural, tidak ada menu tombol, tidak ada pilihan kaku.
Kamu didukung oleh NVIDIA AI (Llama Vision & Nemotron).

KEPRIBADIAN:
- Ramah, santai, profesional — seperti teman yang ahli editing
- Aktif memberi rekomendasi dan inspirasi
- Selalu balas dalam BAHASA YANG SAMA dengan pengguna (default Bahasa Indonesia)
- Jika pengguna tidak mengirim foto/video, tetap jawab pertanyaan mereka dengan normal
- Jika ada gambar, analisis dengan detail (OCR, identifikasi objek, warna, komposisi)

FITUR EDITING YANG KAMU BISA:
FOTO: remove_background, upscale_photo, enhance_photo, anime_effect, cartoon_effect, portrait_enhance, color_correction, remove_object, style_transfer
VIDEO: video_upscale, video_stabilize, video_subtitle, video_caption, video_resize, video_watermark, video_noise_reduction
FOTO KE VIDEO (Kling AI): photo_to_video_cinematic, photo_to_video_zoom, photo_to_video_pan, image_to_video
TEXT KE VIDEO (Kling AI): text_to_video

ROUTING OTOMATIS (internal):
- Permintaan chat, analisis, coding, OCR, dokumen → NVIDIA AI
- Permintaan membuat video dari foto → Kling AI (image_to_video / photo_to_video_*)
- Permintaan membuat video dari teks → Kling AI (text_to_video)

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
- "Buat video dari foto ini" → Rekomendasikan image_to_video (Kling AI), needs_confirmation: true
- "Buat video orang berjalan di pantai" → Rekomendasikan text_to_video (Kling AI), needs_confirmation: true
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

Untuk text_to_video, sertakan prompt video di extra_params: {"prompt": "deskripsi video"}

KATA KONFIRMASI: ya, oke, ok, yap, yep, lakukan, jalankan, yes, go, bagus, mantap, setuju, boleh, bisa, silakan, do it, sure, proceed, gas, lanjut, siap, iya`;

export interface AgentResponse {
  message: string;
  action: EditAction | null;
  needsConfirmation: boolean;
  isConfirmation: boolean;
  askClarification: boolean;
  extraParams?: Record<string, string>;
}

async function callNvidiaWithFallback(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  hasImage: boolean
): Promise<string> {
  if (!nvidiaClient) {
    throw new Error("NVIDIA_API_KEY tidak dikonfigurasi. Admin perlu menambahkan NVIDIA_API_KEY di Secrets.");
  }

  // Pilih model: vision model jika ada gambar, text model untuk teks saja
  const modelsToTry = hasImage
    ? [NVIDIA_VISION_MODEL, NVIDIA_FALLBACK2_MODEL, NVIDIA_FALLBACK_MODEL]
    : [NVIDIA_TEXT_MODEL, NVIDIA_FALLBACK_MODEL, NVIDIA_VISION_MODEL, NVIDIA_FALLBACK2_MODEL];

  for (const model of modelsToTry) {
    try {
      logger.info({ model, hasImage }, "Memanggil NVIDIA NIM API");
      const response = await nvidiaClient.chat.completions.create({
        model,
        max_tokens: 1024,
        messages,
        temperature: 0.7,
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (text) {
        logger.info({ model }, "NVIDIA NIM berhasil merespons");
        return text;
      }
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.code === 429;
      const is503 = err?.status === 503;
      if (is429 || is503) {
        logger.warn({ model, status: err?.status }, "Model rate-limited atau tidak tersedia, coba model berikutnya...");
        continue;
      }
      throw err;
    }
  }
  throw new Error("Semua model NVIDIA sedang penuh. Coba lagi sebentar.");
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

  // Buat user message — jika ada gambar, pakai format vision
  let userHistoryContent: string;
  if (imageBase64) {
    const dataUrl = `data:${imageMediaType ?? "image/jpeg"};base64,${imageBase64}`;
    const textPart = userText ? `dengan keterangan: "${userText}"` : "tanpa keterangan";
    
    // Format multimodal untuk NVIDIA vision model
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `[Pengguna mengirim foto ${textPart}]. Analisis gambar ini dan bantu pengguna.`,
        },
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
      ],
    });
    userHistoryContent = `[Pengguna mengirim foto/gambar]${userText ? ` dengan pesan: "${userText}"` : ""}`;
  } else {
    const content = userText || "[Pengguna mengirim media tanpa pesan]";
    messages.push({ role: "user", content });
    userHistoryContent = content;
  }

  let parsed: AgentResponse = {
    message: "Maaf, saya tidak bisa menjawab saat ini. Coba lagi ya!",
    action: null,
    needsConfirmation: false,
    isConfirmation: false,
    askClarification: false,
  };

  if (!nvidiaClient) {
    parsed.message = "⚠️ NVIDIA AI belum dikonfigurasi. Admin perlu menambahkan NVIDIA_API_KEY di Secrets.";
    return parsed;
  }

  try {
    const rawText = await callNvidiaWithFallback(messages, !!imageBase64);

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

    await db.insert(chatHistoryTable).values([
      { telegramId, role: "user", content: userHistoryContent },
      { telegramId, role: "assistant", content: parsed.message },
    ]);
  } catch (err: any) {
    logger.error({ err }, "NVIDIA Agent error");
    if (err?.message?.includes("rate-limited") || err?.message?.includes("penuh")) {
      parsed.message = "⏳ NVIDIA AI sedang sibuk. Coba lagi dalam 1-2 menit ya!";
    } else if (err?.message?.includes("NVIDIA_API_KEY")) {
      parsed.message = `⚠️ ${err.message}`;
    }
  }

  return parsed;
}

export async function clearHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
