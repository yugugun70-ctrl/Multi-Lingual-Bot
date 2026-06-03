import OpenAI from "openai";
import { db, chatHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getConfigValue } from "../lib/config";
import type { EditAction } from "./state";

function getNvidiaClient(): OpenAI | null {
  const key = getConfigValue("NVIDIA_API_KEY");
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
}

const NVIDIA_VISION_MODEL    = "meta/llama-3.2-11b-vision-instruct";
const NVIDIA_TEXT_MODEL      = "nvidia/llama-3.3-nemotron-super-49b-v1";
const NVIDIA_FALLBACK_MODEL  = "nvidia/llama-3.1-nemotron-nano-8b-v1";
const NVIDIA_FALLBACK2_MODEL = "meta/llama-3.3-70b-instruct";

const SYSTEM_PROMPT = `Kamu adalah EditAI — asisten AI khusus edit foto dan video di Telegram.
Kamu HANYA bisa membantu hal-hal yang berkaitan dengan foto dan video editing.
Kamu didukung oleh NVIDIA AI (Llama Vision & Nemotron).

KEPRIBADIAN:
- Ramah, singkat, profesional
- Balas dalam BAHASA YANG SAMA dengan pengguna (default Bahasa Indonesia)
- TIDAK pernah membahas topik di luar foto/video editing

TOPIK YANG KAMU BOLEH BAHAS:
- Teknik edit foto & video
- Cara pakai tools editing (Adobe, Lightroom, Capcut, dll)
- Saran warna, komposisi, efek
- Analisis foto yang dikirim user
- Fitur editing bot ini

JIKA TOPIK DI LUAR FOTO/VIDEO EDITING:
- Balas dengan off_topic: true di JSON
- Berikan pesan sopan bahwa kamu hanya untuk foto & video editing

AKSI EDITING YANG TERSEDIA:
FOTO: remove_background, upscale_photo, enhance_photo, anime_effect, cartoon_effect, portrait_enhance, color_correction, remove_object, style_transfer
VIDEO: video_upscale, video_enhance, video_stabilize, video_subtitle, video_resize, video_watermark, video_noise_reduction
FOTO→VIDEO: photo_to_video_cinematic, photo_to_video_zoom, photo_to_video_pan, image_to_video
TEKS→VIDEO: text_to_video

ALUR KERJA:
1. User kirim foto + deskripsi edit → pilih action terbaik, langsung set action (jangan minta konfirmasi lagi)
2. User minta langsung ("hapus background sekarang") → set action langsung
3. User tanya tentang editing → jawab dengan natural, action: null
4. Topik lain → off_topic: true

FORMAT RESPONS (WAJIB JSON VALID, tidak ada teks di luar JSON):
{
  "message": "pesan naturalmu ke pengguna",
  "action": null atau nama action,
  "needs_confirmation": false,
  "is_confirmation": false,
  "off_topic": false,
  "extra_params": {}
}`;

export interface AgentResponse {
  message: string;
  action: EditAction | null;
  needsConfirmation: boolean;
  isConfirmation: boolean;
  offTopic: boolean;
  extraParams?: Record<string, string>;
}

async function callNvidiaWithFallback(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  hasImage: boolean
): Promise<string> {
  const modelsToTry = hasImage
    ? [NVIDIA_VISION_MODEL, NVIDIA_FALLBACK2_MODEL, NVIDIA_FALLBACK_MODEL]
    : [NVIDIA_TEXT_MODEL, NVIDIA_FALLBACK_MODEL, NVIDIA_VISION_MODEL, NVIDIA_FALLBACK2_MODEL];

  for (const model of modelsToTry) {
    try {
      logger.info({ model, hasImage }, "Memanggil NVIDIA NIM");
      const response = await client.chat.completions.create({
        model,
        max_tokens: 512,
        messages,
        temperature: 0.6,
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (text) return text;
    } catch (err: any) {
      const skip = err?.status === 429 || err?.status === 503 || err?.status === 404;
      if (skip) { logger.warn({ model, status: err?.status }, "Skip model"); continue; }
      throw err;
    }
  }
  throw new Error("Semua model NVIDIA sedang sibuk. Coba lagi sebentar.");
}

export async function runAgent(
  telegramId: number,
  userText: string,
  imageBase64?: string,
  imageMediaType?: string
): Promise<AgentResponse> {
  const nvidiaClient = getNvidiaClient();

  if (!nvidiaClient) {
    return {
      message: "⚠️ NVIDIA API Key belum dikonfigurasi.\n\nAdmin perlu mengisi API key di halaman setup bot. Hubungi admin.",
      action: null,
      needsConfirmation: false,
      isConfirmation: false,
      offTopic: false,
    };
  }

  const history = await db
    .select()
    .from(chatHistoryTable)
    .where(eq(chatHistoryTable.telegramId, telegramId))
    .orderBy(asc(chatHistoryTable.createdAt))
    .limit(12);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
  ];

  let userHistoryContent: string;
  if (imageBase64) {
    const dataUrl = `data:${imageMediaType ?? "image/jpeg"};base64,${imageBase64}`;
    const textPart = userText ? `dengan permintaan: "${userText}"` : "tanpa keterangan";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `[User mengirim foto ${textPart}]. Analisis dan tentukan action terbaik langsung.` },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    });
    userHistoryContent = `[Foto dikirim]${userText ? ` — "${userText}"` : ""}`;
  } else {
    const content = userText || "[Media tanpa teks]";
    messages.push({ role: "user", content });
    userHistoryContent = content;
  }

  let parsed: AgentResponse = {
    message: "Maaf, saya tidak bisa menjawab saat ini. Coba lagi ya!",
    action: null,
    needsConfirmation: false,
    isConfirmation: false,
    offTopic: false,
  };

  try {
    const rawText = await callNvidiaWithFallback(nvidiaClient, messages, !!imageBase64);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const raw = JSON.parse(jsonMatch[0]) as any;
        parsed = {
          message: raw.message ?? rawText,
          action: (raw.action as EditAction) ?? null,
          needsConfirmation: raw.needs_confirmation ?? false,
          isConfirmation: raw.is_confirmation ?? false,
          offTopic: raw.off_topic ?? false,
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
    if (err?.message?.includes("sibuk") || err?.message?.includes("penuh")) {
      parsed.message = "⏳ AI sedang sibuk. Coba lagi dalam 1-2 menit ya!";
    } else {
      parsed.message = `⚠️ ${err.message?.slice(0, 100) ?? "Terjadi kesalahan"}`;
    }
  }

  return parsed;
}

export async function clearHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
