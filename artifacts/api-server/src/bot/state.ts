import type { TopupTierKey } from "./credits";

export type SubtitleStyle = "classic" | "tiktok" | "capcut";
export type ManualSubtitleStyle = "bold_white" | "tiktok_yellow" | "neon_orange" | "capcut_minimal" | "cinematic";
export type WatermarkPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";
export type WatermarkSize = "small" | "medium" | "large";

export type EditAction =
  | "video_enhance_standard"
  | "video_enhance_pro"
  | "video_enhance_hdr"
  | "video_resolution_ratio"
  | "video_auto_subtitle"
  | "video_manual_subtitle"
  | "video_remove_watermark";

export type MenuMode =
  | "perbaiki"
  | "resolusi"
  | "rasio"
  | "subtitle_main"
  | "subtitle_style"
  | "subtitle_pos"
  | "manual_sub_input"
  | "manual_sub_style"
  | "manual_sub_pos"
  | "watermark_pos"
  | "watermark_size"
  | null;

export interface UserState {
  pending: null;
  menuMode: MenuMode;
  pendingAction: EditAction | null;
  lastVideoFileId: string | null;
  lastVideoFileUrl: string | null;
  awaitingPaymentProof: boolean;
  topupTier: TopupTierKey | null;
  // Auto subtitle
  subtitleStyle: SubtitleStyle;
  subtitlePosition: "top" | "middle" | "bottom" | "custom";
  subtitleCustomY: number;
  awaitingCustomPosition: boolean;
  // Manual subtitle
  awaitingManualSubtitleText: boolean;
  pendingManualSubtitleText: string;
  manualSubtitleStyle: ManualSubtitleStyle;
  manualSubtitlePosition: "top" | "middle" | "bottom";
  // Watermark
  watermarkPosition: WatermarkPosition | null;
  watermarkSize: WatermarkSize;
  // Resolution+Ratio
  pendingResolution: "original" | "hd" | "fhd" | "4k" | null;
  // Processing
  isTranscribing: boolean;
}

const userStates = new Map<number, UserState>();

export function getUserState(telegramId: number): UserState {
  if (!userStates.has(telegramId)) {
    userStates.set(telegramId, {
      pending: null,
      menuMode: null,
      pendingAction: null,
      lastVideoFileId: null,
      lastVideoFileUrl: null,
      awaitingPaymentProof: false,
      topupTier: null,
      subtitleStyle: "classic",
      subtitlePosition: "bottom",
      subtitleCustomY: 85,
      awaitingCustomPosition: false,
      awaitingManualSubtitleText: false,
      pendingManualSubtitleText: "",
      manualSubtitleStyle: "bold_white",
      manualSubtitlePosition: "bottom",
      watermarkPosition: null,
      watermarkSize: "medium",
      pendingResolution: null,
      isTranscribing: false,
    });
  }
  return userStates.get(telegramId)!;
}

export function setUserState(telegramId: number, state: Partial<UserState>): void {
  const current = getUserState(telegramId);
  userStates.set(telegramId, { ...current, ...state });
}

export function clearPending(telegramId: number): void {
  setUserState(telegramId, {
    pendingAction: null,
    menuMode: null,
    pendingResolution: null,
    subtitleStyle: "classic",
    subtitlePosition: "bottom",
    subtitleCustomY: 85,
    awaitingCustomPosition: false,
    awaitingManualSubtitleText: false,
    pendingManualSubtitleText: "",
    watermarkPosition: null,
    watermarkSize: "medium",
    isTranscribing: false,
  });
}
