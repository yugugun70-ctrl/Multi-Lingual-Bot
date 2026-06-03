import { logger } from "../lib/logger";
import {
  videoEnhanceFFmpeg,
  videoStabilizeFFmpeg,
  videoNoiseReductionFFmpeg,
  videoAudioDenoiseFFmpeg,
  videoWatermarkFFmpeg,
  videoQualityFFmpeg,
  videoSubtitleOverlayFFmpeg,
  videoEffectFFmpeg,
  videoRatioFFmpeg,
  videoTrimFFmpeg,
  videoAutoSubtitleFFmpeg,
} from "../lib/video-processor";
import type { TranscriptSegment } from "../lib/transcribe";
import type { EditAction } from "./state";

export interface ToolResult {
  success: boolean;
  outputUrl?: string;
  error?: string;
  message?: string;
  isVideo?: boolean;
}

function wrap(r: { success: boolean; outputUrl?: string; error?: string; message?: string; isVideo?: boolean }): ToolResult {
  return { success: r.success, outputUrl: r.outputUrl, error: r.error, message: r.message, isVideo: r.isVideo };
}

// ─── Video Tools ──────────────────────────────────────────────────────────────

export async function videoEnhance(u: string): Promise<ToolResult>        { return wrap(await videoEnhanceFFmpeg(u)); }
export async function videoStabilize(u: string): Promise<ToolResult>      { return wrap(await videoStabilizeFFmpeg(u)); }
export async function videoNoiseReduction(u: string): Promise<ToolResult> { return wrap(await videoNoiseReductionFFmpeg(u)); }
export async function videoAudioDenoise(u: string): Promise<ToolResult>   { return wrap(await videoAudioDenoiseFFmpeg(u)); }
export async function videoWatermark(u: string, t = "EditAI"): Promise<ToolResult> { return wrap(await videoWatermarkFFmpeg(u, t)); }

export async function videoQualityHD(u: string): Promise<ToolResult>  { return wrap(await videoQualityFFmpeg(u, "hd")); }
export async function videoQualityFHD(u: string): Promise<ToolResult> { return wrap(await videoQualityFFmpeg(u, "fhd")); }
export async function videoQuality4K(u: string): Promise<ToolResult>  { return wrap(await videoQualityFFmpeg(u, "4k")); }

export async function videoSubtitle(u: string, text: string, pos: "top" | "middle" | "bottom" = "bottom"): Promise<ToolResult> {
  return wrap(await videoSubtitleOverlayFFmpeg(u, text, pos));
}

export async function videoAutoSubtitle(u: string, segments: TranscriptSegment[], pos: "top" | "middle" | "bottom" = "bottom"): Promise<ToolResult> {
  return wrap(await videoAutoSubtitleFFmpeg(u, segments, pos));
}

export async function videoEffectCinematic(u: string): Promise<ToolResult> { return wrap(await videoEffectFFmpeg(u, "cinematic")); }
export async function videoEffectBW(u: string): Promise<ToolResult>        { return wrap(await videoEffectFFmpeg(u, "bw")); }
export async function videoEffectVintage(u: string): Promise<ToolResult>   { return wrap(await videoEffectFFmpeg(u, "vintage")); }
export async function videoEffectDrama(u: string): Promise<ToolResult>     { return wrap(await videoEffectFFmpeg(u, "drama")); }
export async function videoEffectVivid(u: string): Promise<ToolResult>     { return wrap(await videoEffectFFmpeg(u, "vivid")); }

export async function videoRatio16_9(u: string): Promise<ToolResult> { return wrap(await videoRatioFFmpeg(u, "16_9")); }
export async function videoRatio9_16(u: string): Promise<ToolResult> { return wrap(await videoRatioFFmpeg(u, "9_16")); }
export async function videoRatio1_1(u: string): Promise<ToolResult>  { return wrap(await videoRatioFFmpeg(u, "1_1")); }
export async function videoRatio4_3(u: string): Promise<ToolResult>  { return wrap(await videoRatioFFmpeg(u, "4_3")); }
export async function videoRatio21_9(u: string): Promise<ToolResult> { return wrap(await videoRatioFFmpeg(u, "21_9")); }

export async function videoTrim(u: string, startSec: number, endSec: number): Promise<ToolResult> {
  return wrap(await videoTrimFFmpeg(u, startSec, endSec));
}

// ─── Router Utama ─────────────────────────────────────────────────────────────

export async function executeEditAction(
  action: EditAction,
  fileUrl: string,
  _fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<ToolResult> {
  switch (action) {
    case "video_enhance":            return videoEnhance(fileUrl);
    case "video_stabilize":          return videoStabilize(fileUrl);
    case "video_noise_reduction":    return videoNoiseReduction(fileUrl);
    case "video_audio_denoise":      return videoAudioDenoise(fileUrl);
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

    case "video_trim":
      return videoTrim(
        fileUrl,
        parseFloat(extraParams?.start ?? "0"),
        parseFloat(extraParams?.end ?? "30")
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
