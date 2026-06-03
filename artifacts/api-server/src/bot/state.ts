export type EditAction =
  | "video_enhance"
  | "video_stabilize"
  | "video_noise_reduction"
  | "video_watermark"
  | "video_quality_hd"
  | "video_quality_fhd"
  | "video_quality_4k"
  | "video_subtitle"
  | "video_effect_cinematic"
  | "video_effect_bw"
  | "video_effect_vintage"
  | "video_effect_drama"
  | "video_effect_vivid"
  | "video_ratio_16_9"
  | "video_ratio_9_16"
  | "video_ratio_1_1"
  | "video_ratio_4_3"
  | "video_ratio_21_9"
  | "photo_to_video_cinematic"
  | "photo_to_video_zoom"
  | "photo_to_video_pan";

export type MenuMode = "main" | "kualitas" | "efek" | "rasio" | "foto_video" | "subtitle_pos" | null;

export interface UserState {
  pending: null;
  menuMode: MenuMode;
  pendingAction: EditAction | null;
  lastPhotoFileId: string | null;
  lastPhotoFileUrl: string | null;
  lastVideoFileId: string | null;
  lastVideoFileUrl: string | null;
  awaitingPaymentProof: boolean;
  awaitingSubtitleText: boolean;
  subtitlePosition: "top" | "middle" | "bottom";
}

const userStates = new Map<number, UserState>();

export function getUserState(telegramId: number): UserState {
  if (!userStates.has(telegramId)) {
    userStates.set(telegramId, {
      pending: null,
      menuMode: null,
      pendingAction: null,
      lastPhotoFileId: null,
      lastPhotoFileUrl: null,
      lastVideoFileId: null,
      lastVideoFileUrl: null,
      awaitingPaymentProof: false,
      awaitingSubtitleText: false,
      subtitlePosition: "bottom",
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
  });
}
