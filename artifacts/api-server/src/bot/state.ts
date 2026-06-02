export type EditAction =
  | "remove_background"
  | "upscale_photo"
  | "enhance_photo"
  | "anime_effect"
  | "cartoon_effect"
  | "portrait_enhance"
  | "color_correction"
  | "remove_object"
  | "style_transfer"
  | "photo_to_video_cinematic"
  | "photo_to_video_zoom"
  | "photo_to_video_pan"
  | "video_upscale"
  | "video_stabilize"
  | "video_subtitle"
  | "video_caption"
  | "video_resize"
  | "video_watermark"
  | "video_noise_reduction";

export interface PendingEdit {
  action: EditAction;
  fileId: string;
  fileType: "photo" | "video";
  extraParams?: Record<string, string>;
  description: string;
}

export interface UserState {
  pending: PendingEdit | null;
  lastPhotoFileId: string | null;
  lastPhotoFileUrl: string | null;
  lastVideoFileId: string | null;
  awaitingPaymentProof: boolean;
}

const userStates = new Map<number, UserState>();

export function getUserState(telegramId: number): UserState {
  if (!userStates.has(telegramId)) {
    userStates.set(telegramId, {
      pending: null,
      lastPhotoFileId: null,
      lastPhotoFileUrl: null,
      lastVideoFileId: null,
      awaitingPaymentProof: false,
    });
  }
  return userStates.get(telegramId)!;
}

export function setUserState(telegramId: number, state: Partial<UserState>): void {
  const current = getUserState(telegramId);
  userStates.set(telegramId, { ...current, ...state });
}

export function clearPending(telegramId: number): void {
  const current = getUserState(telegramId);
  userStates.set(telegramId, { ...current, pending: null });
}
