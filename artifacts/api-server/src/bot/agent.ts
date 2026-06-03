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

const NVIDIA_PRIMARY_MODEL   = "nvidia/llama-3.1-nemotron-nano-8b-v1";
const NVIDIA_VISION_MODEL    = "meta/llama-3.2-11b-vision-instruct";
const NVIDIA_FALLBACK_MODEL  = "meta/llama-3.3-70b-instruct";

const SYSTEM_PROMPT = `Kamu adalah EditAI, bot Telegram untuk edit foto & video.
HANYA balas dalam format JSON berikut — tidak boleh ada teks lain:
{"message":"balasanmu","action":null,"off_topic":false}

Daftar action yang valid:
remove_background, upscale_photo, enhance_photo, anime_effect, cartoon_effect,
glow_effect, hdr_effect, sketch_effect, neon_effect, oil_paint_effect, vintage_effect,
color_correction, portrait_enhance, photo_to_video_cinematic, photo_to_video_zoom,
photo_to_video_pan, video_enhance

ATURAN:
- Jika user minta edit foto/video → set action sesuai
- Jika user tanya tentang editing → jelaskan singkat, action null
- Jika topik lain → off_topic true, tolak sopan
- Selalu balas bahasa Indonesia
- message harus singkat, ramah, profesional`;

export interface AgentResponse {
  message: string;
  action: EditAction | null;
  needsConfirmation: boolean;
  isConfirmation: boolean;
  offTopic: boolean;
  extraParams?: Record<string, string>;
}

// Normalisasi alias action dari model → EditAction yang valid
const ACTION_ALIASES: Record<string, EditAction> = {
  "remove_bg":              "remove_background",
  "remove background":      "remove_background",
  "removebg":               "remove_background",
  "background_removal":     "remove_background",
  "upscale":                "upscale_photo",
  "upscale_image":          "upscale_photo",
  "enhance":                "enhance_photo",
  "enhance_image":          "enhance_photo",
  "improve_quality":        "enhance_photo",
  "anime":                  "anime_effect",
  "cartoon":                "cartoon_effect",
  "hdr":                    "hdr_effect",
  "glow":                   "glow_effect",
  "bloom":                  "glow_effect",
  "sketch":                 "sketch_effect",
  "pencil_sketch":          "sketch_effect",
  "neon":                   "neon_effect",
  "cyberpunk":              "neon_effect",
  "oil_paint":              "oil_paint_effect",
  "oil_painting":           "oil_paint_effect",
  "vintage":                "vintage_effect",
  "retro":                  "vintage_effect",
  "film_grain":             "vintage_effect",
  "color":                  "color_correction",
  "color_correct":          "color_correction",
  "color_enhance":          "color_correction",
  "portrait":               "portrait_enhance",
  "face_enhance":           "portrait_enhance",
  "photo_to_video":         "photo_to_video_cinematic",
  "image_to_video":         "photo_to_video_cinematic",
  "cinematic":              "photo_to_video_cinematic",
  "zoom_video":             "photo_to_video_zoom",
  "pan_video":              "photo_to_video_pan",
  "video_quality":          "video_enhance",
  "enhance_video":          "video_enhance",
  "stabilize":              "video_stabilize",
  "denoise":                "video_noise_reduction",
  "noise_reduction":        "video_noise_reduction",
  "watermark":              "video_watermark",
  "subtitle":               "video_subtitle",
};

const VALID_ACTIONS = new Set<string>([
  "remove_background","upscale_photo","enhance_photo","anime_effect","cartoon_effect",
  "hdr_effect","glow_effect","sketch_effect","neon_effect","oil_paint_effect","vintage_effect",
  "portrait_enhance","color_correction","remove_object","style_transfer",
  "photo_to_video_cinematic","photo_to_video_zoom","photo_to_video_pan",
  "image_to_video","text_to_video",
  "video_upscale","video_enhance","video_stabilize","video_subtitle","video_caption",
  "video_resize","video_watermark","video_noise_reduction",
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
    action: null,
    needsConfirmation: false,
    isConfirmation: false,
    offTopic: false,
  };

  // Cari JSON di dalam teks (ambil yang pertama ditemukan)
  const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return fallback;

  try {
    const raw = JSON.parse(jsonMatch[0]) as any;
    // Validasi: message harus string pendek (bukan template/format guide)
    const msg = String(raw.message ?? "").trim();
    if (!msg || msg.length > 1000 || msg.includes('"action"') || msg.includes('"message"')) {
      return fallback;
    }
    return {
      message: msg,
      action: normalizeAction(raw.action),
      needsConfirmation: false,
      isConfirmation: false,
      offTopic: !!raw.off_topic,
      extraParams: raw.extra_params ?? undefined,
    };
  } catch {
    return fallback;
  }
}

async function callNvidiaModel(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  hasImage: boolean
): Promise<string> {
  const orderedModels = hasImage
    ? [NVIDIA_VISION_MODEL, NVIDIA_PRIMARY_MODEL, NVIDIA_FALLBACK_MODEL]
    : [NVIDIA_PRIMARY_MODEL, NVIDIA_FALLBACK_MODEL, NVIDIA_VISION_MODEL];

  for (const model of orderedModels) {
    try {
      logger.info({ model, hasImage }, "Memanggil NVIDIA");
      const response = await client.chat.completions.create({
        model,
        max_tokens: 300,
        temperature: 0.3,
        messages,
      });
      const text = response.choices[0]?.message?.content?.trim() ?? "";
      if (text) return text;
    } catch (err: any) {
      const skip = err?.status === 429 || err?.status === 503 || err?.status === 404;
      if (skip) { logger.warn({ model, status: err?.status }, "Skip model"); continue; }
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
  const nvidiaClient = getNvidiaClient();

  if (!nvidiaClient) {
    return {
      message: "NVIDIA API Key belum dikonfigurasi. Hubungi admin untuk mengisi API key.",
      action: null, needsConfirmation: false, isConfirmation: false, offTopic: false,
    };
  }

  const history = await db
    .select()
    .from(chatHistoryTable)
    .where(eq(chatHistoryTable.telegramId, telegramId))
    .orderBy(asc(chatHistoryTable.createdAt))
    .limit(8);

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
    const request = userText ? `"${userText}"` : "pilihkan action terbaik";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `User kirim foto, minta: ${request}. Balas JSON saja.` },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    });
    userHistoryContent = `[Foto] ${userText || ""}`;
  } else {
    const content = `${userText || "[Media]"} → balas JSON saja!`;
    messages.push({ role: "user", content });
    userHistoryContent = userText || "[Media]";
  }

  let parsed: AgentResponse = {
    message: "Maaf, ada gangguan. Coba lagi ya!",
    action: null, needsConfirmation: false, isConfirmation: false, offTopic: false,
  };

  try {
    const rawText = await callNvidiaModel(nvidiaClient, messages, !!imageBase64);
    logger.debug({ rawText: rawText.slice(0, 200) }, "NVIDIA raw response");
    parsed = parseAgentResponse(rawText);

    await db.insert(chatHistoryTable).values([
      { telegramId, role: "user", content: userHistoryContent },
      { telegramId, role: "assistant", content: parsed.message },
    ]);
  } catch (err: any) {
    logger.error({ err }, "NVIDIA Agent error");
    parsed.message = err?.message?.includes("sibuk")
      ? "AI sedang sibuk, coba lagi dalam 1-2 menit ya!"
      : "Terjadi kesalahan sementara. Coba lagi ya!";
  }

  return parsed;
}

export async function clearHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
