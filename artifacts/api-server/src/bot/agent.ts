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
video_enhance_standard, video_enhance_pro, video_enhance_hdr,
video_resolution_ratio, video_auto_subtitle

ATURAN:
- video_enhance_standard = perbaiki standar (denoise ringan + sharpen + warna)
- video_enhance_pro = perbaiki pro (kualitas tinggi, tajam, cerah)
- video_enhance_hdr = efek HDR (warna hidup, kontras dinamis, premium)
- video_resolution_ratio = ubah resolusi atau rasio video
- video_auto_subtitle = buat subtitle otomatis dari suara video
- Jika user minta jernihkan/perbaiki video → video_enhance_standard
- Jika user minta kualitas terbaik/pro/profesional → video_enhance_pro
- Jika user minta HDR/warna hidup → video_enhance_hdr
- Jika user minta resolusi/HD/4K/rasio/tiktok/reels → video_resolution_ratio
- Jika user minta subtitle/caption/teks otomatis → video_auto_subtitle
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
  "enhance": "video_enhance_standard",
  "enhance_standard": "video_enhance_standard",
  "standar": "video_enhance_standard",
  "jernihkan": "video_enhance_standard",
  "jernih": "video_enhance_standard",
  "bersihkan": "video_enhance_standard",
  "enhance_pro": "video_enhance_pro",
  "pro": "video_enhance_pro",
  "profesional": "video_enhance_pro",
  "hdr": "video_enhance_hdr",
  "enhance_hdr": "video_enhance_hdr",
  "warna_hidup": "video_enhance_hdr",
  "resolution_ratio": "video_resolution_ratio",
  "resolusi": "video_resolution_ratio",
  "rasio": "video_resolution_ratio",
  "hd": "video_resolution_ratio",
  "4k": "video_resolution_ratio",
  "fhd": "video_resolution_ratio",
  "auto_subtitle": "video_auto_subtitle",
  "subtitle": "video_auto_subtitle",
  "caption": "video_auto_subtitle",
  "teks": "video_auto_subtitle",
  "transkripsi": "video_auto_subtitle",
  "subtitle_otomatis": "video_auto_subtitle",
};

const VALID_ACTIONS = new Set<string>([
  "video_enhance_standard",
  "video_enhance_pro",
  "video_enhance_hdr",
  "video_resolution_ratio",
  "video_auto_subtitle",
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
