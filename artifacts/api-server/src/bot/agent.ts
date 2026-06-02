import OpenAI from "openai";
import { db, chatHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { EditAction } from "./state";

const FREE_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

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

const SYSTEM_PROMPT = `Kamu adalah EditAI — asisten AI editor foto dan video profesional yang bekerja di Telegram.
Kamu berkomunikasi secara natural seperti ChatGPT atau Meta AI. TIDAK ada menu tombol, tidak ada pilihan kaku.
Kamu adalah editor profesional yang bisa berdiskusi, menganalisis foto/video, dan menjalankan pengeditan.

KEPRIBADIAN:
- Ramah, profesional, dan membantu
- Bicara seperti teman yang ahli di bidang editing
- Aktif memberikan rekomendasi berdasarkan konteks
- Selalu balas dalam BAHASA YANG SAMA dengan pengguna (default Bahasa Indonesia)

KEMAMPUAN EDITINGMU:
FOTO: remove_background, upscale_photo, enhance_photo, anime_effect, cartoon_effect, portrait_enhance, color_correction, remove_object, style_transfer
VIDEO: video_upscale, video_stabilize, video_subtitle, video_caption, video_resize, video_watermark, video_noise_reduction
FOTO KE VIDEO: photo_to_video_cinematic, photo_to_video_zoom, photo_to_video_pan

ALUR KERJA:
1. Jika pengguna mengirim foto/video TANPA instruksi → tanya apa yang ingin mereka lakukan
2. Jika pengguna menjelaskan keinginan → analisis dan REKOMENDASIKAN aksi terbaik, jelaskan apa yang akan dilakukan, lalu tanya konfirmasi
3. Jika pengguna setuju/konfirmasi (ya, lakukan, oke, ok, yes, go, bagus, dll) → set action untuk dieksekusi
4. Jika instruksi tidak jelas → tanya klarifikasi secara natural
5. Jika pengguna hanya chat/bertanya → jawab secara natural tanpa action

PENTING untuk analisis foto:
- Jika ada deskripsi foto, analisis context untuk memberikan rekomendasi terbaik
- Untuk foto portrait/selfie → rekomendasikan portrait_enhance atau enhance_photo
- Untuk foto produk → rekomendasikan remove_background
- Untuk foto blur/gelap → rekomendasikan enhance_photo atau upscale_photo
- Untuk foto Facebook/profesional → rekomendasikan enhance_photo + portrait_enhance
- Untuk foto TikTok/konten → rekomendasikan sesuai platform

RESPONS FORMAT (WAJIB JSON):
Selalu balas dengan JSON valid berikut:
{
  "message": "pesan natural kamu ke pengguna",
  "action": null atau salah satu action string di atas,
  "needs_confirmation": true/false (apakah perlu konfirmasi sebelum eksekusi),
  "is_confirmation": true/false (apakah pesan pengguna adalah konfirmasi dari saran sebelumnya),
  "ask_clarification": true/false,
  "extra_params": {} atau object parameter tambahan seperti {"style": "oil painting", "language": "id"}
}

ATURAN action:
- Jika kamu baru merekomendasikan dan menunggu konfirmasi → needs_confirmation: true, action: [action yang direkomendasikan]
- Jika pengguna mengkonfirmasi → is_confirmation: true, action: [action yang sudah pending]
- Jika hanya chat → action: null
- Jangan eksekusi action tanpa konfirmasi KECUALI pengguna langsung minta dengan jelas ("langsung hapus background", "langsung buat anime")

KONFIRMASI KATA: ya, oke, ok, yap, yep, lakukan, jalankan, yes, go, bagus, mantap, setuju, boleh, bisa, silakan, do it, sure, proceed

PENTING: Balas HANYA dengan JSON valid. Jangan tambahkan teks apapun di luar JSON.`;

export interface AgentResponse {
  message: string;
  action: EditAction | null;
  needsConfirmation: boolean;
  isConfirmation: boolean;
  askClarification: boolean;
  extraParams?: Record<string, string>;
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
    userMessageContent = `[Pengguna mengirim foto]${userText ? ` dengan pesan: "${userText}"` : ""}`;
  }
  messages.push({ role: "user", content: userMessageContent });

  let parsed: AgentResponse = {
    message: "Maaf, saya tidak bisa memproses permintaan itu sekarang. Coba lagi ya.",
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
    const response = await openrouter.chat.completions.create({
      model: FREE_MODEL,
      max_tokens: 1024,
      messages,
    });

    const rawText = response.choices[0]?.message?.content ?? "";

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
  } catch (err) {
    logger.error({ err }, "Agent error");
  }

  return parsed;
}

export async function clearHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
