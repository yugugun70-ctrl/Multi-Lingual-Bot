import type { TranscriptSegment } from "../lib/transcribe";
import type { TopupTierKey } from "./credits";

export type EditAction =
  | "video_enhance"
  | "video_stabilize"
  | "video_noise_reduction"
  | "video_audio_denoise"
  | "video_watermark"
  | "video_trim"
  | "video_quality_hd"
  | "video_quality_fhd"
  | "video_quality_4k"
  | "video_subtitle"
  | "video_auto_subtitle"
  | "video_effect_cinematic"
  | "video_effect_bw"
  | "video_effect_vintage"
  | "video_effect_drama"
  | "video_effect_vivid"
  | "video_ratio_16_9"
  | "video_ratio_9_16"
  | "video_ratio_1_1"
  | "video_ratio_4_3"
  | "video_ratio_21_9";

export type MenuMode =
  | "main"
  | "kualitas"
  | "efek"
  | "rasio"
  | "subtitle_pos"
  | "auto_subtitle_pos"
  | null;

export interface UserState {
  pending: null;
  menuMode: MenuMode;
  pendingAction: EditAction | null;
  lastVideoFileId: string | null;
  lastVideoFileUrl: string | null;
  awaitingPaymentProof: boolean;
  topupTier: TopupTierKey | null;
  awaitingSubtitleText: boolean;
  subtitlePosition: "top" | "middle" | "bottom";
  awaitingTrimTime: boolean;
  pendingTranscriptSegments: TranscriptSegment[] | null;
  transcriptSuggestedPosition: "top" | "middle" | "bottom";
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
      awaitingSubtitleText: false,
      subtitlePosition: "bottom",
      awaitingTrimTime: false,
      pendingTranscriptSegments: null,
      transcriptSuggestedPosition: "bottom",
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
    awaitingSubtitleText: false,
    subtitlePosition: "bottom",
    awaitingTrimTime: false,
    pendingTranscriptSegments: null,
    isTranscribing: false,
  });
}
