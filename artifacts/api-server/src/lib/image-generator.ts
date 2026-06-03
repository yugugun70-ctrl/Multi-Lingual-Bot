import { logger } from "./logger";

export interface GenerateImageResult {
  success: boolean;
  outputUrl?: string;
  mimeType?: string;
  error?: string;
  message?: string;
}

// NVIDIA NIM — Text-to-Image menggunakan Stable Diffusion XL
export async function generateImageNvidia(prompt: string): Promise<GenerateImageResult> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return { success: false, error: "NVIDIA_API_KEY diperlukan untuk membuat gambar." };
  }

  const modelsToTry = [
    "stability/stable-diffusion-xl",
    "stabilityai/stable-diffusion-3-medium",
    "stabilityai/stable-diffusion-xl-base-1.0",
  ];

  for (const model of modelsToTry) {
    try {
      logger.info({ model, prompt: prompt.slice(0, 80) }, "Generating image via NVIDIA NIM");

      const res = await fetch("https://integrate.api.nvidia.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: "1024x1024",
          response_format: "b64_json",
        }),
      });

      if (res.ok) {
        const data = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
        const item = data.data?.[0];
        if (item?.b64_json) {
          const dataUrl = `data:image/png;base64,${item.b64_json}`;
          return {
            success: true,
            outputUrl: dataUrl,
            mimeType: "image/png",
            message: `✅ Gambar berhasil dibuat dari deskripsi kamu!`,
          };
        }
        if (item?.url) {
          return {
            success: true,
            outputUrl: item.url,
            mimeType: "image/png",
            message: `✅ Gambar berhasil dibuat dari deskripsi kamu!`,
          };
        }
      }

      const errText = await res.text().catch(() => "");
      // 404 = model tidak tersedia, coba berikutnya
      if (res.status === 404) {
        logger.warn({ model }, "Model tidak tersedia, coba model berikutnya");
        continue;
      }

      logger.error({ model, status: res.status, errText }, "Image generation gagal");
      return { success: false, error: `Gagal membuat gambar (${res.status}): ${errText.slice(0, 100)}` };
    } catch (err: any) {
      logger.error({ model, err }, "Image generation error");
      continue;
    }
  }

  // Semua model gagal — buat placeholder via sharp (gambar teks)
  return generateImageFallback(prompt);
}

// Fallback: buat gambar teks menggunakan sharp jika semua SDXL model tidak tersedia
async function generateImageFallback(prompt: string): Promise<GenerateImageResult> {
  try {
    const sharp = (await import("sharp")).default;

    const lines = wrapText(prompt, 38);
    const lineH = 36;
    const padding = 60;
    const imgW = 800;
    const imgH = Math.max(400, padding * 2 + lines.length * lineH + 80);

    const svgLines = lines
      .map((l, i) => `<text x="400" y="${padding + 60 + i * lineH}" font-family="Arial" font-size="26" fill="#e0e0e0" text-anchor="middle">${escXml(l)}</text>`)
      .join("\n");

    const svg = `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${imgW}" height="${imgH}" fill="#1a1a2e"/>
  <rect x="30" y="30" width="${imgW - 60}" height="${imgH - 60}" rx="16" fill="#16213e" stroke="#0f3460" stroke-width="2"/>
  <text x="400" y="55" font-family="Arial" font-size="18" fill="#e94560" text-anchor="middle" font-weight="bold">⚠️ Text-to-Image NVIDIA belum aktif</text>
  <text x="400" y="85" font-family="Arial" font-size="15" fill="#a0a0c0" text-anchor="middle">Prompt kamu:</text>
  ${svgLines}
  <text x="400" y="${imgH - 35}" font-family="Arial" font-size="14" fill="#607080" text-anchor="middle">EditAI — Top up kredit NVIDIA untuk aktifkan fitur ini</text>
</svg>`;

    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    return {
      success: true,
      outputUrl: `data:image/png;base64,${buf.toString("base64")}`,
      mimeType: "image/png",
      message: `⚠️ Fitur Text-to-Image belum aktif di NVIDIA NIM. Gambar placeholder dikirim. Hubungi admin untuk mengaktifkan model SDXL.`,
    };
  } catch (e: any) {
    return { success: false, error: `Text-to-image tidak tersedia: ${e.message}` };
  }
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) {
      cur = (cur + " " + w).trim();
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
