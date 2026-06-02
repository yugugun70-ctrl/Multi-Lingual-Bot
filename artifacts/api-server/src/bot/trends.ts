import { anthropic } from "../lib/anthropic";

const TREND_SYSTEM = `Kamu adalah seorang ahli tren konten visual dan social media yang up-to-date.
Berikan rekomendasi tren editing foto/video dan ide konten yang sedang populer.
Jawab dalam bahasa Indonesia yang santai dan inspiratif. Format respons dengan rapi menggunakan emoji.`;

export async function getTrendIdeas(category: "foto" | "video" | "general"): Promise<string> {
  let prompt = "";

  if (category === "foto") {
    prompt = "Berikan 5 tren editing foto yang sedang viral dan populer saat ini di media sosial. Sertakan tips singkat dan hashtag yang relevan.";
  } else if (category === "video") {
    prompt = "Berikan 5 tren editing video yang sedang viral dan populer saat ini di media sosial. Sertakan tips singkat dan style yang sedang tren.";
  } else {
    prompt = "Berikan inspirasi konten visual yang sedang tren: 3 tren foto, 2 tren video, dan 2 ide konten kreatif yang bisa langsung dibuat.";
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8192,
    system: TREND_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "Gagal mendapatkan informasi tren.";
}
