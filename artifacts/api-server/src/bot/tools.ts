import { logger } from "../lib/logger";
import {
  videoEnhanceStandardFFmpeg,
  videoEnhanceProFFmpeg,
  videoEnhanceHDRFFmpeg,
  videoResolutionRatioFFmpeg,
  videoAutoSubtitleFFmpeg,
} from "../lib/video-processor";
import type { TranscriptSegment } from "../lib/transcribe";
import type { EditAction, SubtitleStyle } from "./state";

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

// ─── Perbaiki Video ───────────────────────────────────────────────────────────

export async function videoEnhanceStandard(u: string): Promise<ToolResult> {
  return wrap(await videoEnhanceStandardFFmpeg(u));
}

export async function videoEnhancePro(u: string): Promise<ToolResult> {
  return wrap(await videoEnhanceProFFmpeg(u));
}

export async function videoEnhanceHDR(u: string): Promise<ToolResult> {
  return wrap(await videoEnhanceHDRFFmpeg(u));
}

// ─── Resolusi & Rasio ─────────────────────────────────────────────────────────

export async function videoResolutionRatio(
  u: string,
  resolution: "original" | "hd" | "fhd" | "4k",
  ratio: "9_16" | "1_1" | "16_9" | "keep"
): Promise<ToolResult> {
  return wrap(await videoResolutionRatioFFmpeg(u, resolution, ratio));
}

// ─── Auto Subtitle ────────────────────────────────────────────────────────────

export async function videoAutoSubtitle(
  u: string,
  segments: TranscriptSegment[],
  position: "top" | "middle" | "bottom" | "custom" = "bottom",
  style: SubtitleStyle = "classic",
  customYPercent: number = 85
): Promise<ToolResult> {
  return wrap(await videoAutoSubtitleFFmpeg(u, segments, position, style, customYPercent));
}

// ─── Router Utama ─────────────────────────────────────────────────────────────

export async function executeEditAction(
  action: EditAction,
  fileUrl: string,
  _fileType: "photo" | "video",
  extraParams?: Record<string, string>
): Promise<ToolResult> {
  switch (action) {
    case "video_enhance_standard": return videoEnhanceStandard(fileUrl);
    case "video_enhance_pro":      return videoEnhancePro(fileUrl);
    case "video_enhance_hdr":      return videoEnhanceHDR(fileUrl);

    case "video_resolution_ratio":
      return videoResolutionRatio(
        fileUrl,
        (extraParams?.resolution ?? "original") as "original" | "hd" | "fhd" | "4k",
        (extraParams?.ratio ?? "keep") as "9_16" | "1_1" | "16_9" | "keep"
      );

    default:
      return { success: false, error: "Aksi tidak dikenali." };
  }
}
