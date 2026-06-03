import type { TopupTierKey } from "./credits";

export type SubtitleStyle = "classic" | "tiktok" | "capcut";

export type EditAction =
  | "video_enhance_standard"
  | "video_enhance_pro"
  | "video_enhance_hdr"
  | "video_resolution_ratio"
  | "video_auto_subtitle";

export type MenuMode =
  | "perbaiki"
  | "resolusi"
  | "rasio"
  | "subtitle_style"
  | "subtitle_pos"
  | null;

export interface UserState {
  pending: null;
  menuMode: MenuMode;
  pendingAction: EditAction | null;
  lastVideoFileId: string | null;
  lastVideoFileUrl: string | null;
  awaitingPaymentProof: boolean;
  topupTier: TopupTierKey | null;
  subtitleStyle: SubtitleStyle;
  subtitlePosition: "top" | "middle" | "bottom" | "custom";
  subtitleCustomY: number;
  awaitingCustomPosition: boolean;
  pendingResolution: "original" | "hd" | "fhd" | "4k" | null;
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
    isTranscribing: false,
  });
}
