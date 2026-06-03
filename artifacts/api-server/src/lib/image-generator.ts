import { logger } from "./logger";
import { getConfigValue } from "./config";

export interface GenerateImageResult {
  success: boolean;
  outputUrl?: string;
  mimeType?: string;
  error?: string;
  message?: string;
}

// ─── Text-to-Image via NVIDIA NIM ────────────────────────────────────────────

export async function generateImageNvidia(prompt: string): Promise<GenerateImageResult> {
  const apiKey = getConfigValue("NVIDIA_API_KEY");
  if (!apiKey) {
    return { success: false, error: "NVIDIA_API_KEY diperlukan. Hubungi admin untuk mengisi di halaman setup." };
  }

  // Model terbaru NVIDIA NIM untuk image generation
  const modelsToTry = [
    { endpoint: "https://integrate.api.nvidia.com/v1/images/generations", model: "stability/stable-diffusion-xl" },
    { endpoint: "https://integrate.api.nvidia.com/v1/images/generations", model: "stabilityai/stable-diffusion-xl-base-1.0" },
    { endpoint: "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl", model: "sdxl" },
    { endpoint: "https://ai.api.nvidia.com/v1/genai/stabilityai/sdxl-turbo", model: "sdxl-turbo" },
  ];

  for (const { endpoint, model } of modelsToTry) {
    try {
      logger.info({ model, prompt: prompt.slice(0, 80) }, "Generating image via NVIDIA");

      const body = endpoint.includes("genai")
        ? JSON.stringify({ text_prompts: [{ text: prompt }], seed: 0, sampler: "K_EULER_ANCESTRAL", steps: 25 })
        : JSON.stringify({ model, prompt, n: 1, size: "1024x1024", response_format: "b64_json" });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(60000),
      });

      if (res.status === 404) { logger.warn({ model }, "Model 404, skip"); continue; }
      if (!res.ok) { const t = await res.text().catch(()=>""); logger.warn({ model, status: res.status, t }, "Image gen gagal"); continue; }

      const data = await res.json() as any;
      const b64 = data.data?.[0]?.b64_json ?? data.artifacts?.[0]?.base64;
      if (b64) {
        return { success: true, outputUrl: `data:image/png;base64,${b64}`, mimeType: "image/png", message: "Gambar berhasil dibuat!" };
      }
      const url = data.data?.[0]?.url;
      if (url) {
        return { success: true, outputUrl: url, mimeType: "image/png", message: "Gambar berhasil dibuat!" };
      }
    } catch (err: any) {
      logger.warn({ model, err: err.message }, "Image gen error, skip");
      continue;
    }
  }

  return {
    success: false,
    error: "Fitur Teks → Foto memerlukan model NVIDIA NIM yang belum aktif di akun ini.\n\n" +
           "Silakan hubungi admin atau aktifkan model Stable Diffusion XL di dashboard NVIDIA NIM.\n\n" +
           "Alternatif: gunakan fitur Edit Foto yang tersedia.",
  };
}
