import { logger } from "../lib/logger";
import {
  videoEnhanceStandardFFmpeg,
  videoEnhanceProFFmpeg,
  videoEnhanceHDRFFmpeg,
  videoResolutionRatioFFmpeg,
  videoAutoSubtitleFFmpeg,
  videoManualSubtitleFFmpeg,
  videoRemoveWatermarkFFmpeg,
} from "../lib/video-processor";
import type { TranscriptSegment } from "../lib/transcribe";
import type { EditAction, SubtitleStyle, ManualSubtitleStyle, WatermarkPosition, WatermarkSize } from "./state";

export interface ToolResult {
  success: boolean;
  outputUrl?: string;
  error?: string;
  message?: string;
  isVideo?: boolean;
}

function wrap(r: { success: boolean; outputUrl?: string; error?: string; message?: string; isVideo?: boolean }): ToolResult {
  return r;
}

export const videoEnhanceStandard = (u: string)                              => wrap(videoEnhanceStandardFFmpeg(u));
export const videoEnhancePro      = (u: string)                              => wrap(videoEnhanceProFFmpeg(u));
export const videoEnhanceHDR      = (u: string)                              => wrap(videoEnhanceHDRFFmpeg(u));

export const videoResolutionRatio = (
  u: string,
  resolution: "original" | "hd" | "fhd" | "4k",
  ratio: "9_16" | "1_1" | "16_9" | "keep"
) => wrap(videoResolutionRatioFFmpeg(u, resolution, ratio));

export const videoAutoSubtitle = (
  u: string,
  segments: TranscriptSegment[],
  position: "top" | "middle" | "bottom" | "custom" = "bottom",
  style: SubtitleStyle = "classic",
  customYPercent: number = 85
) => wrap(videoAutoSubtitleFFmpeg(u, segments, position, style, customYPercent));

export const videoManualSubtitle = (
  u: string,
  text: string,
  style: ManualSubtitleStyle = "bold_white",
  position: "top" | "middle" | "bottom" = "bottom"
) => wrap(videoManualSubtitleFFmpeg(u, text, style, position));

export const videoRemoveWatermark = (
  u: string,
  position: WatermarkPosition,
  size: WatermarkSize = "medium"
) => wrap(videoRemoveWatermarkFFmpeg(u, position, size));

// ─── Router ───────────────────────────────────────────────────────────────────

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

    case "video_remove_watermark":
      return videoRemoveWatermark(
        fileUrl,
        (extraParams?.position ?? "top_right") as WatermarkPosition,
        (extraParams?.size ?? "medium") as WatermarkSize
      );

    default:
      return { success: false, error: "Aksi tidak dikenali." };
  }
}
