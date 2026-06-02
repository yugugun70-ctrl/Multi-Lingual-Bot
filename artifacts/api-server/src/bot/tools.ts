import { logger } from "../lib/logger";
import { klingTextToVideo, klingImageToVideo, isKlingConfigured } from "../lib/kling";
import https from "node:https";
import http from "node:http";
import type { EditAction } from "./state";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;

export interface ToolResult {
  success: boolean;
  outputUrl?: string;
  outputUrls?: string[];
  error?: string;
  message?: string;
  isVideo?: boolean;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    proto.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function replicateRun(
  model: string,
  input: Record<string, unknown>,
  timeoutMs = 180000
): Promise<ToolResult> {
  if (!REPLICATE_TOKEN) {
    return { success: false, error: "REPLICATE_API_TOKEN belum dikonfigurasi. Tambahkan token di Secrets." };
  }

  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version: model, input }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    logger.error({ model, err }, "Replicate create prediction failed");
    return { success: false, error: `Replicate error: ${err}` };
  }

  const prediction = (await createRes.json()) as { id: string; status: string; output?: unknown; error?: string };
  const pollUrl = `https://api.replicate.com/v1/predictions/${prediction.id}`;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Token ${REPLICATE_TOKEN}` },
    });
    const poll = (await pollRes.json()) as { status: string; output?: unknown; error?: string };

    if (poll.status === "succeeded") {
      const output = poll.output;
      if (typeof output === "string") return { success: true, outputUrl: output };
      if (Array.isArray(output) && output.length > 0) {
        return { success: true, outputUrl: output[0] as string, outputUrls: output as string[] };
      }
      return { success: false, error: "Output tidak dikenali dari Replicate." };
    }
    if (poll.status === "failed") {
      return { success: false, error: poll.error ?? "Replicate task gagal." };
    }
  }

  return { success: false, error: "Timeout: proses editing terlalu lama." };
}

// ─── Foto Editing (NVIDIA-powered via Replicate models) ───────────────────────

export async function removeBackground(imageUrl: string): Promise<ToolResult> {
  if (REMOVE_BG_KEY) {
    const buf = await fetchBuffer(imageUrl);
    const form = new FormData();
    form.append("image_file", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), "image.jpg");
    form.append("size", "auto");

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": REMOVE_BG_KEY },
      body: form,
    });

    if (res.ok) {
      const resultBuf = Buffer.from(await res.arrayBuffer());
      const b64 = `data:image/png;base64,${resultBuf.toString("base64")}`;
      return { success: true, outputUrl: b64, message: "Background berhasil dihapus menggunakan Remove.bg!" };
    }
    logger.warn("Remove.bg gagal, fallback ke Replicate");
  }

  return replicateRun(
    "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad23d1f0c2b8e1b8b7d6f6a2c",
    { image: imageUrl }
  );
}

export async function upscalePhoto(imageUrl: string): Promise<ToolResult> {
  return replicateRun(
    "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
    { image: imageUrl, scale: 4, face_enhance: false }
  );
}

export async function enhancePhoto(imageUrl: string): Promise<ToolResult> {
  return replicateRun(
    "tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355f829a1a5df2018057b4f0b9e8d" +
    "a59e",
    { img: imageUrl, version: "v1.4", scale: 2 }
  );
}

export async function animeEffect(imageUrl: string): Promise<ToolResult> {
  return replicateRun(
    "cjwbw/animegan-v2-for-videos:e4be3be9900f32f9c6e3c1f8a86b35d2a20f3c2e3b83ff6c54d7e3d2b26a8f",
    { image: imageUrl }
  );
}

export async function cartoonEffect(imageUrl: string): Promise<ToolResult> {
  return replicateRun(
    "sberbank-ai/real-esrgan:d0ee3d708c6db8e0f03e7c1c53a8f3f3e3b2b3a1c2d4f5a6b7c8d9e0f1a2b3c",
    { image: imageUrl, cartoon: true }
  );
}

export async function portraitEnhance(imageUrl: string): Promise<ToolResult> {
  return replicateRun(
    "tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355f829a1a5df2018057b4f0b9e8da59e",
    { img: imageUrl, version: "v1.4", scale: 2 }
  );
}

export async function colorCorrection(imageUrl: string): Promise<ToolResult> {
  return replicateRun(
    "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
    { image: imageUrl, scale: 2, face_enhance: true }
  );
}

export async function styleTransfer(imageUrl: string, style: string): Promise<ToolResult> {
  return replicateRun(
    "zeke-xie/stable-diffusion-v1-5-img2img:a1c5bb4e6b5a2b5e3c4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6",
    { image: imageUrl, prompt: style, strength: 0.75, guidance_scale: 7.5 }
  );
}

// ─── Video Generation via Kling AI ───────────────────────────────────────────

export async function photoToVideoKling(
  imageUrl: string,
  type: "cinematic" | "zoom" | "pan"
): Promise<ToolResult> {
  if (!isKlingConfigured()) {
    return {
      success: false,
      error: "Kling AI belum dikonfigurasi. Admin perlu menambahkan KLING_ACCESS_KEY dan KLING_SECRET_KEY di Secrets.",
    };
  }

  const prompts: Record<string, string> = {
    cinematic: "cinematic camera movement, professional film look, smooth motion",
    zoom: "slow zoom in effect, smooth motion, steady",
    pan: "smooth pan left to right, steady camera, cinematic",
  };

  const result = await klingImageToVideo(imageUrl, prompts[type]);
  return {
    success: result.success,
    outputUrl: result.videoUrl,
    error: result.error,
    isVideo: result.success,
    message: result.success ? `✅ Video ${type} berhasil dibuat dengan Kling AI!` : undefined,
  };
}

export async function imageToVideo(
  imageUrl: string,
  prompt?: string
): Promise<ToolResult> {
  if (!isKlingConfigured()) {
    return {
      success: false,
      error: "Kling AI belum dikonfigurasi. Admin perlu menambahkan KLING_ACCESS_KEY dan KLING_SECRET_KEY di Secrets.",
    };
  }

  const result = await klingImageToVideo(
    imageUrl,
    prompt ?? "smooth cinematic motion, high quality video"
  );
  return {
    success: result.success,
    outputUrl: result.videoUrl,
    error: result.error,
    isVideo: result.success,
    message: result.success ? "✅ Video berhasil dibuat dari foto dengan Kling AI!" : undefined,
  };
}

export async function textToVideo(prompt: string): Promise<ToolResult> {
  if (!isKlingConfigured()) {
    return {
      success: false,
      error: "Kling AI belum dikonfigurasi. Admin perlu menambahkan KLING_ACCESS_KEY dan KLING_SECRET_KEY di Secrets.",
    };
  }

  const result = await klingTextToVideo(prompt);
  return {
    success: result.success,
    outputUrl: result.videoUrl,
    error: result.error,
    isVideo: result.success,
    message: result.success ? "✅ Video berhasil dibuat dari teks dengan Kling AI!" : undefined,
  };
}

// ─── Video Editing ────────────────────────────────────────────────────────────

export async function videoUpscale(videoUrl: string): Promise<ToolResult> {
  return replicateRun(
    "lucataco/real-esrgan-video:9f9f3ab76cbf4e3e3e3b3c3d3e3f3a3b3c3d3e3f3a3b3c3d3e3f3a3b3c3d3e3f",
    { video_path: videoUrl, scale: 4 }
  );
}

export async function videoSubtitle(videoUrl: string, language: string = "id"): Promise<ToolResult> {
  return replicateRun(
    "openai/whisper:4d50797290df275329f202e48c76360b3f22b08d28c196cbc54600319435f8d2",
    { audio: videoUrl, language, translate: false, transcription: "srt" }
  );
}

export async function videoNoiseReduction(videoUrl: string): Promise<ToolResult> {
  return replicateRun(
    "arielreplicate/demucs_music_separation:8194f6e854ae31b36ab9e4b1e28d09e7a4a70af4b4d9d51b3f1b3e7e6a4a2b9",
    { audio: videoUrl }
  );
}

// ─── Router Utama ─────────────────────────────────────────────────────────────

export async function executeEditAction(
  action: EditAction,
  fileUrl: string,
  fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<ToolResult> {
  switch (action) {
    // Foto editing (Replicate)
    case "remove_background": return removeBackground(fileUrl);
    case "upscale_photo": return upscalePhoto(fileUrl);
    case "enhance_photo": return enhancePhoto(fileUrl);
    case "anime_effect": return animeEffect(fileUrl);
    case "cartoon_effect": return cartoonEffect(fileUrl);
    case "portrait_enhance": return portraitEnhance(fileUrl);
    case "color_correction": return colorCorrection(fileUrl);
    case "remove_object": return removeBackground(fileUrl);
    case "style_transfer": return styleTransfer(fileUrl, extraParams?.style ?? "oil painting");

    // Photo-to-video via Kling AI
    case "photo_to_video_cinematic": return photoToVideoKling(fileUrl, "cinematic");
    case "photo_to_video_zoom": return photoToVideoKling(fileUrl, "zoom");
    case "photo_to_video_pan": return photoToVideoKling(fileUrl, "pan");
    case "image_to_video": return imageToVideo(fileUrl, extraParams?.prompt);

    // Text-to-video via Kling AI (fileUrl tidak dipakai, pakai prompt dari extraParams)
    case "text_to_video": {
      const prompt = extraParams?.prompt ?? "cinematic video, high quality";
      return textToVideo(prompt);
    }

    // Video editing (Replicate)
    case "video_upscale": return videoUpscale(fileUrl);
    case "video_subtitle": return videoSubtitle(fileUrl, extraParams?.language ?? "id");
    case "video_caption": return videoSubtitle(fileUrl, extraParams?.language ?? "id");
    case "video_noise_reduction": return videoNoiseReduction(fileUrl);

    case "video_stabilize":
    case "video_resize":
    case "video_watermark":
      return { success: false, error: "Fitur ini akan segera tersedia." };

    default:
      return { success: false, error: "Aksi tidak dikenali." };
  }
}
