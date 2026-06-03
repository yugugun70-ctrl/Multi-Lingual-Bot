import { logger } from "../lib/logger";
import { fetchBuffer } from "../lib/image-processor";
import {
  videoEnhanceFFmpeg,
  videoStabilizeFFmpeg,
  videoNoiseReductionFFmpeg,
  videoWatermarkFFmpeg,
  videoQualityFFmpeg,
  videoSubtitleOverlayFFmpeg,
  videoEffectFFmpeg,
  videoRatioFFmpeg,
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

// ─── Photo → Video ────────────────────────────────────────────────────────────

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

// ─── Video Tools ──────────────────────────────────────────────────────────────

export async function videoEnhance(videoUrl: string): Promise<ToolResult>       { return wrap(await videoEnhanceFFmpeg(videoUrl)); }
export async function videoStabilize(videoUrl: string): Promise<ToolResult>     { return wrap(await videoStabilizeFFmpeg(videoUrl)); }
export async function videoNoiseReduction(videoUrl: string): Promise<ToolResult>{ return wrap(await videoNoiseReductionFFmpeg(videoUrl)); }
export async function videoWatermark(videoUrl: string, text = "EditAI"): Promise<ToolResult> { return wrap(await videoWatermarkFFmpeg(videoUrl, text)); }

export async function videoQualityHD(videoUrl: string): Promise<ToolResult>     { return wrap(await videoQualityFFmpeg(videoUrl, "hd")); }
export async function videoQualityFHD(videoUrl: string): Promise<ToolResult>    { return wrap(await videoQualityFFmpeg(videoUrl, "fhd")); }
export async function videoQuality4K(videoUrl: string): Promise<ToolResult>     { return wrap(await videoQualityFFmpeg(videoUrl, "4k")); }

export async function videoSubtitle(videoUrl: string, text: string, position: "top" | "middle" | "bottom" = "bottom"): Promise<ToolResult> {
  return wrap(await videoSubtitleOverlayFFmpeg(videoUrl, text, position));
}

export async function videoEffectCinematic(videoUrl: string): Promise<ToolResult> { return wrap(await videoEffectFFmpeg(videoUrl, "cinematic")); }
export async function videoEffectBW(videoUrl: string): Promise<ToolResult>        { return wrap(await videoEffectFFmpeg(videoUrl, "bw")); }
export async function videoEffectVintage(videoUrl: string): Promise<ToolResult>   { return wrap(await videoEffectFFmpeg(videoUrl, "vintage")); }
export async function videoEffectDrama(videoUrl: string): Promise<ToolResult>     { return wrap(await videoEffectFFmpeg(videoUrl, "drama")); }
export async function videoEffectVivid(videoUrl: string): Promise<ToolResult>     { return wrap(await videoEffectFFmpeg(videoUrl, "vivid")); }

export async function videoRatio16_9(videoUrl: string): Promise<ToolResult>      { return wrap(await videoRatioFFmpeg(videoUrl, "16_9")); }
export async function videoRatio9_16(videoUrl: string): Promise<ToolResult>      { return wrap(await videoRatioFFmpeg(videoUrl, "9_16")); }
export async function videoRatio1_1(videoUrl: string): Promise<ToolResult>       { return wrap(await videoRatioFFmpeg(videoUrl, "1_1")); }
export async function videoRatio4_3(videoUrl: string): Promise<ToolResult>       { return wrap(await videoRatioFFmpeg(videoUrl, "4_3")); }
export async function videoRatio21_9(videoUrl: string): Promise<ToolResult>      { return wrap(await videoRatioFFmpeg(videoUrl, "21_9")); }

// ─── Router Utama ─────────────────────────────────────────────────────────────

export async function executeEditAction(
  action: EditAction,
  fileUrl: string,
  _fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<ToolResult> {
  switch (action) {
    case "photo_to_video_cinematic": return photoToVideo(fileUrl, "cinematic");
    case "photo_to_video_zoom":      return photoToVideo(fileUrl, "zoom");
    case "photo_to_video_pan":       return photoToVideo(fileUrl, "pan");

    case "video_enhance":            return videoEnhance(fileUrl);
    case "video_stabilize":          return videoStabilize(fileUrl);
    case "video_noise_reduction":    return videoNoiseReduction(fileUrl);
    case "video_watermark":          return videoWatermark(fileUrl, extraParams?.text ?? "EditAI");

    case "video_quality_hd":         return videoQualityHD(fileUrl);
    case "video_quality_fhd":        return videoQualityFHD(fileUrl);
    case "video_quality_4k":         return videoQuality4K(fileUrl);

    case "video_subtitle":
      return videoSubtitle(
        fileUrl,
        extraParams?.text ?? "Subtitle",
        (extraParams?.position as "top" | "middle" | "bottom") ?? "bottom"
      );

    case "video_effect_cinematic":   return videoEffectCinematic(fileUrl);
    case "video_effect_bw":          return videoEffectBW(fileUrl);
    case "video_effect_vintage":     return videoEffectVintage(fileUrl);
    case "video_effect_drama":       return videoEffectDrama(fileUrl);
    case "video_effect_vivid":       return videoEffectVivid(fileUrl);

    case "video_ratio_16_9":         return videoRatio16_9(fileUrl);
    case "video_ratio_9_16":         return videoRatio9_16(fileUrl);
    case "video_ratio_1_1":          return videoRatio1_1(fileUrl);
    case "video_ratio_4_3":          return videoRatio4_3(fileUrl);
    case "video_ratio_21_9":         return videoRatio21_9(fileUrl);

    default:
      return { success: false, error: "Aksi tidak dikenali." };
  }
}
