import { InlineKeyboard, Keyboard } from "grammy";

export function mainMenuKeyboard() {
  return new Keyboard()
    .text("📷 Edit Foto").text("🎬 Edit Video").row()
    .text("🖼️ Foto ke Video").text("🔥 Trend Assistant").row()
    .text("💬 AI Chat").text("💳 Kredit Saya").row()
    .resized()
    .persistent();
}

export function photoEditKeyboard() {
  return new InlineKeyboard()
    .text("✨ Jernihkan Foto", "photo_enhance").row()
    .text("🔍 Upscale Resolusi", "photo_upscale").row()
    .text("🗑️ Hapus Objek", "photo_remove_object").row()
    .text("✂️ Hapus Background", "photo_remove_bg").row()
    .text("🏞️ Ganti Background", "photo_replace_bg").row()
    .text("🎨 Koreksi Warna", "photo_color").row()
    .text("💄 Portrait Enhancement", "photo_portrait").row()
    .text("🖌️ Style Transfer", "photo_style").row()
    .text("🎭 Efek Kartun", "photo_cartoon").row()
    .text("🌸 Efek Anime", "photo_anime").row()
    .text("⬅️ Kembali", "back_main");
}

export function videoEditKeyboard() {
  return new InlineKeyboard()
    .text("🔍 Video Upscale", "video_upscale").row()
    .text("📽️ Stabilisasi Video", "video_stabilize").row()
    .text("🔇 Hapus Noise", "video_noise").row()
    .text("📝 Generate Subtitle", "video_subtitle").row()
    .text("💬 Auto Caption", "video_caption").row()
    .text("📐 Resize Video", "video_resize").row()
    .text("💧 Watermark", "video_watermark").row()
    .text("⬅️ Kembali", "back_main");
}

export function photoToVideoKeyboard() {
  return new InlineKeyboard()
    .text("🎬 Cinematic Movement", "p2v_cinematic").row()
    .text("🔎 Zoom Effect", "p2v_zoom").row()
    .text("↔️ Pan Effect", "p2v_pan").row()
    .text("🤖 AI Animation", "p2v_animate").row()
    .text("⬅️ Kembali", "back_main");
}

export function afterReceivePhotoKeyboard() {
  return new InlineKeyboard()
    .text("✨ Jernihkan Foto", "photo_enhance").text("🔍 Upscale", "photo_upscale").row()
    .text("✂️ Hapus Background", "photo_remove_bg").text("🗑️ Hapus Objek", "photo_remove_object").row()
    .text("🏞️ Ganti Background", "photo_replace_bg").text("🎨 Koreksi Warna", "photo_color").row()
    .text("💄 Portrait", "photo_portrait").text("🎭 Kartun", "photo_cartoon").row()
    .text("🌸 Anime", "photo_anime").text("🖌️ Style Transfer", "photo_style").row()
    .text("🎬 Jadikan Video", "p2v_cinematic");
}

export function afterReceiveVideoKeyboard() {
  return new InlineKeyboard()
    .text("🔍 Upscale", "video_upscale").text("📽️ Stabilkan", "video_stabilize").row()
    .text("📝 Subtitle", "video_subtitle").text("💬 Caption", "video_caption").row()
    .text("🔇 Hapus Noise", "video_noise").text("📐 Resize", "video_resize").row()
    .text("💧 Watermark", "video_watermark");
}

export function adminKeyboard() {
  return new InlineKeyboard()
    .text("👥 Daftar User", "admin_users").row()
    .text("📊 Statistik", "admin_stats").row()
    .text("📢 Broadcast", "admin_broadcast").row();
}
