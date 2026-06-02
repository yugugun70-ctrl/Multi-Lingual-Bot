import { logger } from "../lib/logger";
import {
  removeBackgroundLocal,
  upscalePhotoSharp,
  enhancePhotoSharp,
  colorCorrectionSharp,
  portraitEnhanceSharp,
  animeEffectHF,
  cartoonEffectSharp,
  styleTransferHF,
  generateSubtitleHF,
} from "../lib/image-processor";
import {
  videoUpscaleFFmpeg,
  videoStabilizeFFmpeg,
  videoResizeFFmpeg,
  videoWatermarkFFmpeg,
  videoNoiseReductionFFmpeg,
  photoToVideoFFmpeg,
} from "../lib/video-processor";
import { klingTextToVideo, klingImageToVideo, isKlingConfigured } from "../lib/kling";
import type { EditAction } from "./state";

export interface ToolResult {
  success: boolean;
  outputUrl?: string;
  outputUrls?: string[];
  error?: string;
  message?: string;
  isVideo?: boolean;
}

// ─── Photo Editing — GRATIS (lokal + HF) ─────────────────────────────────────

export async function removeBackground(imageUrl: string): Promise<ToolResult> {
  // Coba remove.bg dulu jika ada key (berbayar), fallback ke lokal gratis
  const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;
  if (REMOVE_BG_KEY) {
    try {
      const { default: https } = await import("node:https");
      const { default: http } = await import("node:http");
      const fetchBuf = (url: string) => new Promise<Buffer>((resolve, reject) => {
        const proto = url.startsWith("https") ? https : http;
        proto.get(url, (res) => {
          const c: Buffer[] = [];
          res.on("data", (d) => c.push(d));
          res.on("end", () => resolve(Buffer.concat(c)));
          res.on("error", reject);
        }).on("error", reject);
      });

      const buf = await fetchBuf(imageUrl);
      const form = new FormData();
      form.append("image_file", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), "image.jpg");
      form.append("size", "auto");
      const res = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": REMOVE_BG_KEY },
        body: form,
      });
      if (res.ok) {
        const rb = Buffer.from(await res.arrayBuffer());
        return { success: true, outputUrl: `data:image/png;base64,${rb.toString("base64")}`, message: "Background berhasil dihapus (Remove.bg)!" };
      }
    } catch (err) {
      logger.warn({ err }, "Remove.bg gagal, fallback ke lokal");
    }
  }
  // Fallback gratis — @imgly/background-removal-node
  const r = await removeBackgroundLocal(imageUrl);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function upscalePhoto(imageUrl: string): Promise<ToolResult> {
  const r = await upscalePhotoSharp(imageUrl, 3);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function enhancePhoto(imageUrl: string): Promise<ToolResult> {
  const r = await enhancePhotoSharp(imageUrl);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function animeEffect(imageUrl: string): Promise<ToolResult> {
  const r = await animeEffectHF(imageUrl);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function cartoonEffect(imageUrl: string): Promise<ToolResult> {
  const r = await cartoonEffectSharp(imageUrl);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function portraitEnhance(imageUrl: string): Promise<ToolResult> {
  const r = await portraitEnhanceSharp(imageUrl);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function colorCorrection(imageUrl: string): Promise<ToolResult> {
  const r = await colorCorrectionSharp(imageUrl);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function styleTransfer(imageUrl: string, style: string): Promise<ToolResult> {
  const r = await styleTransferHF(imageUrl, style);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

// ─── Video Generation — Kling AI (dengan fallback FFmpeg) ────────────────────

export async function photoToVideo(
  imageUrl: string,
  type: "cinematic" | "zoom" | "pan"
): Promise<ToolResult> {
  // Coba Kling AI dulu jika terkonfigurasi
  if (isKlingConfigured()) {
    const prompts: Record<string, string> = {
      cinematic: "cinematic camera movement, professional film look, smooth motion",
      zoom: "slow zoom in effect, smooth motion, steady",
      pan: "smooth pan left to right, steady camera, cinematic",
    };
    const r = await klingImageToVideo(imageUrl, prompts[type]);
    if (r.success) {
      return { success: true, outputUrl: r.videoUrl, isVideo: true, message: `Video ${type} berhasil dibuat (Kling AI)!` };
    }
    logger.warn({ err: r.error }, "Kling gagal, fallback ke FFmpeg Ken Burns");
  }

  // Fallback gratis — FFmpeg Ken Burns
  const r = await photoToVideoFFmpeg(imageUrl, type);
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

export async function imageToVideo(imageUrl: string, prompt?: string): Promise<ToolResult> {
  if (isKlingConfigured()) {
    const r = await klingImageToVideo(imageUrl, prompt ?? "smooth cinematic motion, high quality");
    if (r.success) {
      return { success: true, outputUrl: r.videoUrl, isVideo: true, message: "Video berhasil dibuat dari foto (Kling AI)!" };
    }
    logger.warn({ err: r.error }, "Kling image2video gagal, fallback ke FFmpeg");
  }
  const r = await photoToVideoFFmpeg(imageUrl, "cinematic");
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

export async function textToVideo(prompt: string): Promise<ToolResult> {
  if (!isKlingConfigured()) {
    return { success: false, error: "Kling AI diperlukan untuk Text-to-Video. Admin perlu menambahkan KLING_ACCESS_KEY dan KLING_SECRET_KEY di Secrets." };
  }
  const r = await klingTextToVideo(prompt);
  return { success: r.success, outputUrl: r.videoUrl, isVideo: r.success, error: r.error, message: r.success ? "Video berhasil dibuat dari teks (Kling AI)!" : undefined };
}

// ─── Video Editing — GRATIS via FFmpeg ───────────────────────────────────────

export async function videoUpscale(videoUrl: string): Promise<ToolResult> {
  const r = await videoUpscaleFFmpeg(videoUrl);
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

export async function videoSubtitle(videoUrl: string, language = "id"): Promise<ToolResult> {
  const r = await generateSubtitleHF(videoUrl, language);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

export async function videoStabilize(videoUrl: string): Promise<ToolResult> {
  const r = await videoStabilizeFFmpeg(videoUrl);
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

export async function videoResize(videoUrl: string, width = 1280, height = 720): Promise<ToolResult> {
  const r = await videoResizeFFmpeg(videoUrl, width, height);
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

export async function videoWatermark(videoUrl: string, text = "EditAI"): Promise<ToolResult> {
  const r = await videoWatermarkFFmpeg(videoUrl, text);
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

export async function videoNoiseReduction(videoUrl: string): Promise<ToolResult> {
  const r = await videoNoiseReductionFFmpeg(videoUrl);
  return { success: r.success, outputUrl: r.outputUrl, isVideo: r.isVideo, error: r.error, message: r.message };
}

// ─── Router Utama ─────────────────────────────────────────────────────────────

export async function executeEditAction(
  action: EditAction,
  fileUrl: string,
  fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<ToolResult> {
  switch (action) {
    // Foto editing (gratis: lokal + HF)
    case "remove_background": return removeBackground(fileUrl);
    case "upscale_photo":     return upscalePhoto(fileUrl);
    case "enhance_photo":     return enhancePhoto(fileUrl);
    case "anime_effect":      return animeEffect(fileUrl);
    case "cartoon_effect":    return cartoonEffect(fileUrl);
    case "portrait_enhance":  return portraitEnhance(fileUrl);
    case "color_correction":  return colorCorrection(fileUrl);
    case "remove_object":     return removeBackground(fileUrl);
    case "style_transfer":    return styleTransfer(fileUrl, extraParams?.style ?? "oil painting");

    // Photo-to-video (Kling AI + fallback FFmpeg)
    case "photo_to_video_cinematic": return photoToVideo(fileUrl, "cinematic");
    case "photo_to_video_zoom":      return photoToVideo(fileUrl, "zoom");
    case "photo_to_video_pan":       return photoToVideo(fileUrl, "pan");
    case "image_to_video":           return imageToVideo(fileUrl, extraParams?.prompt);

    // Text-to-video (Kling AI only)
    case "text_to_video": {
      const prompt = extraParams?.prompt ?? "cinematic video, high quality";
      return textToVideo(prompt);
    }

    // Video editing (gratis: FFmpeg)
    case "video_upscale":         return videoUpscale(fileUrl);
    case "video_subtitle":        return videoSubtitle(fileUrl, extraParams?.language ?? "id");
    case "video_caption":         return videoSubtitle(fileUrl, extraParams?.language ?? "id");
    case "video_stabilize":       return videoStabilize(fileUrl);
    case "video_resize":          return videoResize(fileUrl);
    case "video_watermark":       return videoWatermark(fileUrl, extraParams?.text ?? "EditAI");
    case "video_noise_reduction": return videoNoiseReduction(fileUrl);

    default:
      return { success: false, error: "Aksi tidak dikenali." };
  }
}
