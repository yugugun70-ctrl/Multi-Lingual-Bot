import { anthropic } from "../lib/anthropic";
import { db, chatHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const SYSTEM_PROMPT = `Kamu adalah asisten AI editor foto dan video yang ramah dan profesional bernama "EditAI Bot". 
Kamu berbicara dalam bahasa Indonesia secara default, tapi bisa menanggapi dalam bahasa apapun yang digunakan pengguna.

Tugas utamamu:
1. Membantu pengguna memahami fitur-fitur editing foto dan video yang tersedia
2. Memberikan rekomendasi teknik editing yang tepat sesuai kebutuhan
3. Menjawab pertanyaan seputar editing foto dan video
4. Memberikan inspirasi dan ide konten visual yang sedang tren
5. Memandu pengguna menggunakan fitur bot dengan benar

Fitur editing foto yang tersedia:
- Jernihkan Foto (Enhance): Meningkatkan kualitas dan ketajaman foto
- Upscale Resolusi: Memperbesar ukuran foto tanpa kehilangan kualitas
- Hapus Objek: Menghapus objek yang tidak diinginkan dari foto
- Hapus Background: Menghilangkan latar belakang foto secara otomatis
- Ganti Background: Mengganti latar belakang dengan yang baru
- Koreksi Warna: Memperbaiki dan menyeimbangkan warna foto
- Portrait Enhancement: Memperindah foto portrait/wajah
- Style Transfer: Mengubah gaya artistik foto
- Efek Kartun: Mengubah foto menjadi ilustrasi kartun
- Efek Anime: Mengubah foto menjadi gaya anime

Fitur editing video yang tersedia:
- Video Upscale: Meningkatkan resolusi video
- Stabilisasi Video: Menstabilkan video yang goyang
- Hapus Noise: Mengurangi noise/gangguan pada video
- Generate Subtitle: Membuat subtitle otomatis
- Auto Caption: Menambahkan caption otomatis
- Resize Video: Mengubah ukuran video
- Watermark: Menambahkan watermark pada video

Fitur Foto ke Video:
- Cinematic Movement: Membuat gerakan sinematik dari foto
- Zoom Effect: Efek zoom pada foto
- Pan Effect: Efek pan/geser pada foto
- AI Animation: Animasi AI dari foto

Selalu bersikap ramah, membantu, dan profesional. Jika pengguna menggunakan bahasa selain Indonesia, balas dalam bahasa yang sama.
Jangan memberikan jawaban di luar topik editing foto/video kecuali untuk sapaan umum.`;

export async function getAIResponse(telegramId: number, userMessage: string): Promise<string> {
  const history = await db
    .select()
    .from(chatHistoryTable)
    .where(eq(chatHistoryTable.telegramId, telegramId))
    .orderBy(asc(chatHistoryTable.createdAt))
    .limit(20);

  const messages: { role: "user" | "assistant"; content: string }[] = history.map((h) => ({
    role: h.role as "user" | "assistant",
    content: h.content,
  }));

  messages.push({ role: "user", content: userMessage });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages,
  });

  const assistantMessage = response.content[0].type === "text" ? response.content[0].text : "Maaf, saya tidak bisa memproses permintaan itu.";

  await db.insert(chatHistoryTable).values([
    { telegramId, role: "user", content: userMessage },
    { telegramId, role: "assistant", content: assistantMessage },
  ]);

  return assistantMessage;
}

export async function clearChatHistory(telegramId: number): Promise<void> {
  await db.delete(chatHistoryTable).where(eq(chatHistoryTable.telegramId, telegramId));
}
