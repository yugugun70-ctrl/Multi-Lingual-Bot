import { logger } from "../lib/logger";
import {
  removeBackgroundLocal,
  upscalePhotoSharp,
  enhancePhotoSharp,
  colorCorrectionSharp,
  portraitEnhanceSharp,
  animeEffectHF,
  cartoonEffectSharp,
  hdrEffect,
  glowEffect,
  sketchEffect,
  neonEffect,
  oilPaintEffect,
  vintageEffect,
  styleTransferHF,
  generateSubtitleHF,
  fetchBuffer,
} from "../lib/image-processor";
import {
  videoUpscaleFFmpeg,
  videoEnhanceFFmpeg,
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

function wrap(r: { success: boolean; outputUrl?: string; error?: string; message?: string; isVideo?: boolean }): ToolResult {
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message, isVideo: r.isVideo };
}

// ─── Background Removal ───────────────────────────────────────────────────────

export async function removeBackground(imageUrl: string): Promise<ToolResult> {
  const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;
  if (REMOVE_BG_KEY) {
    try {
      const buf  = await fetchBuffer(imageUrl);
      const form = new FormData();
      form.append("image_file", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), "image.jpg");
      form.append("size", "auto");
      const res = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": REMOVE_BG_KEY },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const rb = Buffer.from(await res.arrayBuffer());
        return { success: true, outputUrl: `data:image/png;base64,${rb.toString("base64")}`, message: "Background dihapus sempurna (Remove.bg AI)!" };
      }
    } catch (err) {
      logger.warn({ err }, "Remove.bg API gagal, fallback ke lokal");
    }
  }
  return wrap(await removeBackgroundLocal(imageUrl));
}

export async function upscalePhoto(imageUrl: string): Promise<ToolResult>       { return wrap(await upscalePhotoSharp(imageUrl, 3)); }
export async function enhancePhoto(imageUrl: string): Promise<ToolResult>       { return wrap(await enhancePhotoSharp(imageUrl)); }
export async function animeEffect(imageUrl: string): Promise<ToolResult>        { return wrap(await animeEffectHF(imageUrl)); }
export async function cartoonEffect(imageUrl: string): Promise<ToolResult>      { return wrap(await cartoonEffectSharp(imageUrl)); }
export async function portraitEnhance(imageUrl: string): Promise<ToolResult>    { return wrap(await portraitEnhanceSharp(imageUrl)); }
export async function colorCorrection(imageUrl: string): Promise<ToolResult>    { return wrap(await colorCorrectionSharp(imageUrl)); }
export async function hdrEffectTool(imageUrl: string): Promise<ToolResult>      { return wrap(await hdrEffect(imageUrl)); }
export async function glowEffectTool(imageUrl: string): Promise<ToolResult>     { return wrap(await glowEffect(imageUrl)); }
export async function sketchEffectTool(imageUrl: string): Promise<ToolResult>   { return wrap(await sketchEffect(imageUrl)); }
export async function neonEffectTool(imageUrl: string): Promise<ToolResult>     { return wrap(await neonEffect(imageUrl)); }
export async function oilPaintEffectTool(imageUrl: string): Promise<ToolResult> { return wrap(await oilPaintEffect(imageUrl)); }
export async function vintageEffectTool(imageUrl: string): Promise<ToolResult>  { return wrap(await vintageEffect(imageUrl)); }
export async function styleTransfer(imageUrl: string, style: string): Promise<ToolResult> { return wrap(await styleTransferHF(imageUrl, style)); }

// ─── Photo → Video ───────────────────────────────────────────────────────────

export async function photoToVideo(imageUrl: string, type: "cinematic" | "zoom" | "pan"): Promise<ToolResult> {
  if (isKlingConfigured()) {
    try {
      const r = await klingImageToVideo(imageUrl, type === "cinematic" ? "cinematic pan" : type);
      if (r.success) return r;
      logger.warn({ err: r.error }, "Kling gagal, fallback FFmpeg");
    } catch (err: any) {
      logger.warn({ err }, "Kling gagal, fallback FFmpeg");
    }
  }
  return wrap(await photoToVideoFFmpeg(imageUrl, type));
}

export async function imageToVideo(imageUrl: string, prompt?: string): Promise<ToolResult> {
  if (isKlingConfigured()) {
    try {
      const r = await klingImageToVideo(imageUrl, prompt ?? "cinematic motion");
      if (r.success) return r;
    } catch {}
  }
  return wrap(await photoToVideoFFmpeg(imageUrl, "cinematic"));
}

export async function textToVideo(prompt: string): Promise<ToolResult> {
  if (isKlingConfigured()) {
    try {
      return await klingTextToVideo(prompt);
    } catch {}
  }
  return { success: false, error: "Fitur Teks → Video memerlukan Kling AI API key. Hubungi admin untuk mengaktifkan." };
}

// ─── Video Editing ────────────────────────────────────────────────────────────

export async function videoUpscale(videoUrl: string): Promise<ToolResult>         { return wrap(await videoUpscaleFFmpeg(videoUrl)); }
export async function videoEnhance(videoUrl: string): Promise<ToolResult>         { return wrap(await videoEnhanceFFmpeg(videoUrl)); }
export async function videoStabilize(videoUrl: string): Promise<ToolResult>       { return wrap(await videoStabilizeFFmpeg(videoUrl)); }
export async function videoResize(videoUrl: string, w = 1280, h = 720): Promise<ToolResult> { return wrap(await videoResizeFFmpeg(videoUrl, w, h)); }
export async function videoWatermark(videoUrl: string, text = "EditAI"): Promise<ToolResult> { return wrap(await videoWatermarkFFmpeg(videoUrl, text)); }
export async function videoNoiseReduction(videoUrl: string): Promise<ToolResult>  { return wrap(await videoNoiseReductionFFmpeg(videoUrl)); }
export async function videoSubtitle(videoUrl: string, lang = "id"): Promise<ToolResult> {
  const r = await generateSubtitleHF(videoUrl, lang);
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message };
}

// ─── Router Utama ─────────────────────────────────────────────────────────────

export async function executeEditAction(
  action: EditAction,
  fileUrl: string,
  fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<ToolResult> {
  switch (action) {
    case "remove_background":        return removeBackground(fileUrl);
    case "upscale_photo":            return upscalePhoto(fileUrl);
    case "enhance_photo":            return enhancePhoto(fileUrl);
    case "anime_effect":             return animeEffect(fileUrl);
    case "cartoon_effect":           return cartoonEffect(fileUrl);
    case "hdr_effect":               return hdrEffectTool(fileUrl);
    case "glow_effect":              return glowEffectTool(fileUrl);
    case "sketch_effect":            return sketchEffectTool(fileUrl);
    case "neon_effect":              return neonEffectTool(fileUrl);
    case "oil_paint_effect":         return oilPaintEffectTool(fileUrl);
    case "vintage_effect":           return vintageEffectTool(fileUrl);
    case "portrait_enhance":         return portraitEnhance(fileUrl);
    case "color_correction":         return colorCorrection(fileUrl);
    case "remove_object":            return removeBackground(fileUrl);
    case "style_transfer":           return styleTransfer(fileUrl, extraParams?.style ?? "oil painting");
    case "photo_to_video_cinematic": return photoToVideo(fileUrl, "cinematic");
    case "photo_to_video_zoom":      return photoToVideo(fileUrl, "zoom");
    case "photo_to_video_pan":       return photoToVideo(fileUrl, "pan");
    case "image_to_video":           return imageToVideo(fileUrl, extraParams?.prompt);
    case "text_to_video":            return textToVideo(extraParams?.prompt ?? "cinematic video");
    case "video_upscale":            return videoUpscale(fileUrl);
    case "video_enhance":            return videoEnhance(fileUrl);
    case "video_stabilize":          return videoStabilize(fileUrl);
    case "video_subtitle":
    case "video_caption":            return videoSubtitle(fileUrl, extraParams?.language ?? "id");
    case "video_resize":             return videoResize(fileUrl);
    case "video_watermark":          return videoWatermark(fileUrl, extraParams?.text ?? "EditAI");
    case "video_noise_reduction":    return videoNoiseReduction(fileUrl);
    default:
      return { success: false, error: "Aksi tidak dikenali." };
  }
}
