import OpenAI from "openai";
import { db, chatHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getConfigValue } from "../lib/config";
import type { EditAction } from "./state";

function getNvidiaClient(): OpenAI | null {
  const key = getConfigValue("NVIDIA_API_KEY");
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: "https://integrate.api.nvidia.com/v1" });
}

const NVIDIA_PRIMARY_MODEL  = "nvidia/llama-3.1-nemotron-nano-8b-v1";
const NVIDIA_VISION_MODEL   = "meta/llama-3.2-11b-vision-instruct";
const NVIDIA_FALLBACK_MODEL = "meta/llama-3.3-70b-instruct";

const SYSTEM_PROMPT = `Kamu adalah EditAI, bot Telegram untuk edit video.
HANYA balas dalam format JSON berikut — tidak boleh ada teks lain:
{"message":"balasanmu","action":null,"off_topic":false}

Daftar action yang valid:
video_enhance, video_stabilize, video_noise_reduction, video_audio_denoise,
video_watermark, video_trim,
video_quality_hd, video_quality_fhd, video_quality_4k,
video_subtitle, video_auto_subtitle,
video_effect_cinematic, video_effect_bw, video_effect_vintage, video_effect_drama, video_effect_vivid,
video_ratio_16_9, video_ratio_9_16, video_ratio_1_1, video_ratio_4_3, video_ratio_21_9

ATURAN:
- Jika user minta edit video → set action sesuai
- video_quality_hd = HD 720p, video_quality_fhd = Full HD 1080p, video_quality_4k = 4K
- video_effect_bw = hitam putih, video_effect_cinematic = warna sinematik
- video_ratio_9_16 = portrait/reels/tiktok, video_ratio_16_9 = landscape/youtube
- video_trim = potong video
- video_audio_denoise = hilangkan noise/gangguan suara dari video
- video_auto_subtitle = buat subtitle otomatis dari suara video
- Jika topik lain → off_topic true, tolak sopan
- Selalu balas bahasa Indonesia, singkat & ramah`;

export interface AgentResponse {
  message: string;
  action: EditAction | null;
  needsConfirmation: boolean;
  isConfirmation: boolean;
  offTopic: boolean;
  extraParams?: Record<string, string>;
}

const ACTION_ALIASES: Record<string, EditAction> = {
  "enhance": "video_enhance", "enhance_video": "video_enhance",
  "jernih": "video_enhance", "jernihkan": "video_enhance",
  "stabilize": "video_stabilize", "stabilisasi": "video_stabilize",
  "denoise": "video_noise_reduction", "noise_reduction": "video_noise_reduction",
  "watermark": "video_watermark",
  "trim": "video_trim", "potong": "video_trim", "cut": "video_trim",
  "hd": "video_quality_hd", "720p": "video_quality_hd",
  "fhd": "video_quality_fhd", "full_hd": "video_quality_fhd", "1080p": "video_quality_fhd",
  "4k": "video_quality_4k", "2160p": "video_quality_4k",
  "subtitle": "video_subtitle", "caption": "video_subtitle", "teks": "video_subtitle",
  "auto_subtitle": "video_auto_subtitle", "auto_caption": "video_auto_subtitle",
  "subtitle_otomatis": "video_auto_subtitle", "transkripsi": "video_auto_subtitle",
  "audio_denoise": "video_audio_denoise", "bersihkan_suara": "video_audio_denoise",
  "noise_audio": "video_audio_denoise", "hapus_noise": "video_audio_denoise",
  "denoise_audio": "video_audio_denoise", "audio_noise": "video_audio_denoise",
  "bising": "video_audio_denoise", "gangguan_suara": "video_audio_denoise",
  "bw": "video_effect_bw", "hitam_putih": "video_effect_bw", "grayscale": "video_effect_bw",
  "cinematic": "video_effect_cinematic", "movie_look": "video_effect_cinematic",
  "vintage": "video_effect_vintage", "retro": "video_effect_vintage",
  "drama": "video_effect_drama", "dramatic": "video_effect_drama",
  "vivid": "video_effect_vivid", "colorful": "video_effect_vivid",
  "landscape": "video_ratio_16_9", "portrait": "video_ratio_9_16",
  "reels": "video_ratio_9_16", "tiktok": "video_ratio_9_16",
  "square": "video_ratio_1_1", "persegi": "video_ratio_1_1",
  "classic": "video_ratio_4_3", "klasik": "video_ratio_4_3",
  "widescreen": "video_ratio_21_9",
};

const VALID_ACTIONS = new Set<string>([
  "video_enhance", "video_stabilize", "video_noise_reduction", "video_audio_denoise",
  "video_watermark", "video_trim",
  "video_quality_hd", "video_quality_fhd", "video_quality_4k",
  "video_subtitle", "video_auto_subtitle",
  "video_effect_cinematic", "video_effect_bw", "video_effect_vintage", "video_effect_drama", "video_effect_vivid",
  "video_ratio_16_9", "video_ratio_9_16", "video_ratio_1_1", "video_ratio_4_3", "video_ratio_21_9",
]);

function normalizeAction(raw: string | null | undefined): EditAction | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (VALID_ACTIONS.has(s)) return s as EditAction;
  if (ACTION_ALIASES[s]) return ACTION_ALIASES[s];
  return null;
}

function parseAgentResponse(rawText: string): AgentResponse {
  const fallback: AgentResponse = {
    message: rawText.trim().slice(0, 300) || "Maaf, coba lagi ya!",
    action: null, needsConfirmation: false, isConfirmation: false, offTopic: false,
  };
  const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return fallback;
  try {
    const raw = JSON.parse(jsonMatch[0]) as any;
    const msg = String(raw.message ?? "").trim();
    if (!msg || msg.length > 1000 || msg.includes('"action"')) return fallback;
    return {
      message: msg,
      action: normalizeAction(raw.action),
      needsConfirmation: false, isConfirmation: false,
      offTopic: !!raw.off_topic,
      extraParams: raw.extra_params ?? undefined,
    };
  } catch { return fallback; }
}

async function callNvidiaModel(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  hasImage: boolean
): Promise<string> {
  const ordered = hasImage
    ? [NVIDIA_VISION_MODEL, NVIDIA_PRIMARY_MODEL, NVIDIA_FALLBACK_MODEL]
    : [NVIDIA_PRIMARY_MODEL, NVIDIA_FALLBACK_MODEL, NVIDIA_VISION_MODEL];

  for (const model of ordered) {
    try {
      logger.info({ model }, "Memanggil NVIDIA");
      const r = await client.chat.completions.create({ model, max_tokens: 300, temperature: 0.3, messages });
      const t = r.choices[0]?.message?.content?.trim() ?? "";
      if (t) return t;
    } catch (err: any) {
      if ([429, 503, 404].includes(err?.status)) { logger.warn({ model, status: err?.status }, "Skip"); continue; }
      throw err;
    }
  }
  throw new Error("Semua model AI sedang sibuk. Coba lagi sebentar.");
}

export async function runAgent(
  telegramId: number,
  userText: string,
  imageBase64?: string,
  imageMediaType?: string
): Promise<AgentResponse> {
  const client = getNvidiaClient();
  if (!client) {
    return { message: "NVIDIA API Key belum dikonfigurasi. Hubungi admin.", action: null, needsConfirmation: false, isConfirmation: false, offTopic: false };
  }

  const history = await db.select().from(chatHistoryTable)
    .where(eq(chatHistoryTable.telegramId, telegramId))
    .orderBy(asc(chatHistoryTable.createdAt)).limit(8);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
  ];

  let userHistoryContent: string;
  if (imageBase64) {
    const dataUrl = `data:${imageMediaType ?? "image/jpeg"};base64,${imageBase64}`;
    const req = userText ? `"${userText}"` : "pilihkan action terbaik";
    messages.push({ role: "user", content: [{ type: "text", text: `User kirim foto, minta: ${req}. Balas JSON saja.` }, { type: "image_url", image_url: { url: dataUrl } }] });
    userHistoryContent = `[Foto] ${userText || ""}`;
  } else {
    messages.push({ role: "user", content: `${userText || "[Media]"} → balas JSON saja!` });
    userHistoryContent = userText || "[Media]";
  }

  let parsed: AgentResponse = { message: "Maaf, ada gangguan. Coba lagi ya!", action: null, needsConfirmation: false, isConfirmation: false, offTopic: false };
  try {
    const rawText = await callNvidiaModel(client, messages, !!imageBase64);
    logger.debug({ rawText: rawText.slice(0, 200) }, "NVIDIA raw");
    parsed = parseAgentResponse(rawText);
    await db.insert(chatHistoryTable).values([
      { telegramId, role: "user", content: userHistoryContent },
      { telegramId, role: "assistant", content: parsed.message },
    ]);
  } catch (err: any) {
    logger.error({ err }, "NVIDIA Agent error");
    parsed.message = err?.message?.includes("sibuk") ? "AI sedang sibuk, coba lagi!" : "Terjadi kesalahan sementara.";
  }
  return parsed;
}

export async function clearHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
