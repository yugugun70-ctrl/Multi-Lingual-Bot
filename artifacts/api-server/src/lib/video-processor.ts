import { logger } from "./logger";
import { fetchBuffer, bufferToTempFile } from "./image-processor";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface VideoResult {
  success: boolean;
  outputUrl?: string;
  mimeType?: string;
  error?: string;
  message?: string;
  isVideo?: boolean;
}

const MAX_DURATION_SEC = 60;

function ffmpeg(): string { return process.env.FFMPEG_PATH ?? "ffmpeg"; }
function ffprobe(): string { return (process.env.FFMPEG_PATH ?? "ffmpeg").replace("ffmpeg", "ffprobe"); }

async function runFF(args: string[], timeoutMs = 120000): Promise<void> {
  const cmd = `${ffmpeg()} ${args.join(" ")}`;
  logger.info({ cmd: cmd.slice(0, 200) }, "FFmpeg");
  const { stderr } = await execAsync(cmd, { timeout: timeoutMs });
  if (stderr) logger.debug({ stderr: stderr.slice(0, 200) }, "FFmpeg stderr");
}

async function toBase64(filePath: string, mime: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function getDuration(inputPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `${ffprobe()} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
    );
    return Math.min(parseFloat(stdout.trim()) || MAX_DURATION_SEC, MAX_DURATION_SEC);
  } catch {
    return MAX_DURATION_SEC;
  }
}

async function cleanup(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
}

// ─── Video Enhance (Jernihkan) — PRESERVE aspect ratio ────────────────────────

export async function videoEnhanceFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_enhance_${Date.now()}.mp4`);

  try {
    const dur    = await getDuration(inputPath);
    // scale ke dimensi genap tanpa ubah rasio (penting untuk codec)
    const filter = [
      "hqdn3d=2:1.5:3:2.5",
      "unsharp=5:5:1.5:3:3:0.5",
      "eq=contrast=1.08:saturation=1.2:brightness=0.02",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video lebih jernih, tajam & warna hidup (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Video enhance gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Quality — scale ke resolusi target, PRESERVE aspect ratio ──────────

export async function videoQualityFFmpeg(
  videoUrl: string,
  preset: "hd" | "fhd" | "4k"
): Promise<VideoResult> {
  // Hanya targetkan tinggi (height), lebar menyesuaikan otomatis → rasio terjaga
  const configs = {
    hd:  { targetH: 720,  label: "HD (720p)",       crf: 20 },
    fhd: { targetH: 1080, label: "Full HD (1080p)", crf: 18 },
    "4k":  { targetH: 2160, label: "4K (2160p)",    crf: 20 },
  };
  const { targetH, label, crf } = configs[preset];

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_qual_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    // -2 = hitung lebar otomatis agar tetap proporsional dan bilangan genap
    const filter = [
      `scale=-2:${targetH}:flags=lanczos`,
      "unsharp=5:5:1.0",
      "eq=contrast=1.05:saturation=1.08",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", `-crf`, String(crf), "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 240000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video dikonversi ke ${label} (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Konversi kualitas gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Subtitle Overlay ────────────────────────────────────────────────────

export async function videoSubtitleOverlayFFmpeg(
  videoUrl: string,
  text: string,
  position: "top" | "middle" | "bottom" = "bottom"
): Promise<VideoResult> {
  const yPos: Record<string, string> = {
    top:    "h*0.05",
    middle: "(h-text_h)/2",
    bottom: "h-text_h-30",
  };
  const posLabel: Record<string, string> = { top: "atas", middle: "tengah", bottom: "bawah" };

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_sub_${Date.now()}.mp4`);

  try {
    const dur      = await getDuration(inputPath);
    const safeText = text
      .replace(/\\/g, "\\\\").replace(/'/g, "\\'")
      .replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

    const filter = `drawtext=text='${safeText}':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=${yPos[position]}:box=1:boxcolor=black@0.55:boxborderw=8:shadowcolor=black@0.5:shadowx=2:shadowy=2`;

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Subtitle di ${posLabel[position]} berhasil ditambahkan (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Subtitle gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Effects — filter sederhana & kompatibel ────────────────────────────

const VIDEO_EFFECT_FILTERS: Record<string, { filter: string; label: string }> = {
  cinematic: {
    // Saturation turun, contrast naik, vignette — movie look
    filter: "eq=contrast=1.12:saturation=0.82:gamma=1.06,vignette=angle=PI/4",
    label: "Sinematik",
  },
  bw: {
    // Hilangkan saturasi → hitam putih
    filter: "hue=s=0,eq=contrast=1.15:brightness=0.02",
    label: "Hitam & Putih",
  },
  vintage: {
    // Tone hangat, saturasi rendah, vignette
    filter: "hue=h=12:s=0.68,eq=contrast=1.06:brightness=-0.02,vignette=angle=PI/3",
    label: "Vintage/Retro",
  },
  drama: {
    // Kontras tinggi, saturasi kuat, vignette
    filter: "eq=contrast=1.4:saturation=1.28:brightness=-0.05,unsharp=5:5:1.0:5:5:0.0,vignette=angle=PI/5",
    label: "Drama",
  },
  vivid: {
    // Saturasi dan kecerahan tinggi
    filter: "eq=saturation=1.8:contrast=1.1:brightness=0.02",
    label: "Vivid/Cerah",
  },
};

export async function videoEffectFFmpeg(
  videoUrl: string,
  effect: "cinematic" | "bw" | "vintage" | "drama" | "vivid"
): Promise<VideoResult> {
  const cfg = VIDEO_EFFECT_FILTERS[effect];
  if (!cfg) return { success: false, error: "Efek tidak dikenali." };

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_fx_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${cfg.filter}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Efek ${cfg.label} berhasil diterapkan (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Efek video gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Ratio ──────────────────────────────────────────────────────────────

const RATIO_CONFIGS: Record<string, { w: number; h: number; label: string }> = {
  "16_9":  { w: 1920, h: 1080, label: "16:9 (Landscape/YouTube)" },
  "9_16":  { w: 1080, h: 1920, label: "9:16 (Portrait/Reels/TikTok)" },
  "1_1":   { w: 1080, h: 1080, label: "1:1 (Square/Instagram)" },
  "4_3":   { w: 1440, h: 1080, label: "4:3 (Klasik)" },
  "21_9":  { w: 2560, h: 1080, label: "21:9 (Sinema Ultrawide)" },
};

export async function videoRatioFFmpeg(
  videoUrl: string,
  ratio: "16_9" | "9_16" | "1_1" | "4_3" | "21_9"
): Promise<VideoResult> {
  const cfg = RATIO_CONFIGS[ratio];
  if (!cfg) return { success: false, error: "Rasio tidak dikenali." };

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_ratio_${Date.now()}.mp4`);

  try {
    const dur    = await getDuration(inputPath);
    const filter = [
      `scale=${cfg.w}:${cfg.h}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${cfg.w}:${cfg.h}:(ow-iw)/2:(oh-ih)/2:black`,
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Rasio diubah ke ${cfg.label} (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Ubah rasio gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Stabilize ──────────────────────────────────────────────────────────

export async function videoStabilizeFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const stabPath   = path.join(os.tmpdir(), `editai_stab_${Date.now()}.trf`);
  const outputPath = path.join(os.tmpdir(), `editai_stable_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"vidstabdetect=shakiness=10:accuracy=15:result='${stabPath}'"`,
      "-f", "null", "-",
    ]);

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"vidstabtransform=input='${stabPath}':zoom=1:smoothing=20,unsharp=5:5:1.0"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video distabilkan (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Video stabilize gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, stabPath, outputPath);
  }
}

// ─── Video Noise Reduction ────────────────────────────────────────────────────

export async function videoNoiseReductionFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_denoise_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"hqdn3d=4:3:6:4.5,unsharp=3:3:0.8"`,
      "-c:v", "libx264", "-crf", "17", "-preset", "medium",
      "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Noise video dikurangi (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Noise reduction gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Watermark ──────────────────────────────────────────────────────────

export async function videoWatermarkFFmpeg(videoUrl: string, text = "EditAI"): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_wm_${Date.now()}.mp4`);

  try {
    const dur      = await getDuration(inputPath);
    const safeText = text.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\\/g, "\\\\");
    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"drawtext=text='${safeText}':fontsize=36:fontcolor=white@0.8:x=w-tw-20:y=h-th-20:shadowcolor=black@0.6:shadowx=2:shadowy=2"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "fast",
      "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Watermark ditambahkan (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Watermark gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Trim (Potong) ──────────────────────────────────────────────────────

export async function videoTrimFFmpeg(
  videoUrl: string,
  startSec: number,
  endSec: number
): Promise<VideoResult> {
  if (startSec < 0 || endSec <= startSec) {
    return { success: false, error: "Waktu tidak valid. Pastikan waktu akhir lebih besar dari waktu awal." };
  }

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_trim_${Date.now()}.mp4`);

  try {
    const dur      = await getDuration(inputPath);
    const safeEnd  = Math.min(endSec, dur);
    const duration = safeEnd - startSec;

    if (duration <= 0) {
      return { success: false, error: `Durasi video hanya ${dur.toFixed(0)}s, tidak bisa potong dari ${startSec}s ke ${endSec}s.` };
    }

    await runFF([
      "-y",
      "-ss", String(startSec),
      "-i", `"${inputPath}"`,
      "-t", String(duration),
      "-c:v", "libx264", "-crf", "18", "-preset", "fast",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 120000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `Video dipotong: ${formatTime(startSec)} → ${formatTime(safeEnd)} (${duration.toFixed(0)}s)!`,
    };
  } catch (err: any) {
    return { success: false, error: `Potong video gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Audio Denoise (Bersihkan Suara) ─────────────────────────────────────────

export async function videoAudioDenoiseFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_adenoise_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);

    // Audio filter chain:
    // highpass=f=80    — buang low rumble (AC hum, angin)
    // afftdn=nf=-20    — FFT noise floor reduction
    // anlmdn=s=7       — adaptive non-local means denoiser (sibilance)
    // loudnorm         — normalisasi loudness agar tidak terlalu pelan/kencang
    const audioFilter = "highpass=f=80,afftdn=nf=-20,anlmdn=s=7,loudnorm";

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-c:v", "copy",               // copy video stream — tidak di-encode ulang (cepat)
      "-af", `"${audioFilter}"`,
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `🔊 Suara video berhasil dijernihkan! (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    logger.error({ err }, "Audio denoise gagal");
    return { success: false, error: `Bersihkan suara gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Auto Subtitle (Timed, dari Whisper) ──────────────────────────────────────

import type { TranscriptSegment } from "./transcribe";

function wrapSubtitleText(text: string, maxChars = 42): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + (current ? " " : "") + word).length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

export async function videoAutoSubtitleFFmpeg(
  videoUrl: string,
  segments: TranscriptSegment[],
  position: "top" | "middle" | "bottom" = "bottom"
): Promise<VideoResult> {

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_autosub_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);

    if (segments.length === 0) {
      return { success: false, error: "Tidak ada segmen subtitle untuk diterapkan." };
    }

    const filters: string[] = segments.flatMap((seg) => {
      const safeStart = Math.max(0, seg.start);
      const safeEnd   = Math.min(seg.end, dur);
      if (safeEnd <= safeStart) return [];

      const lines = wrapSubtitleText(seg.text, 38);
      const lineH  = 42;
      const totalH = lines.length * lineH;

      const yBase = position === "top"    ? "h*0.06"
                  : position === "middle" ? `(h-${totalH})/2`
                  : `h-${totalH}-40`;

      return lines.map((line, idx) => {
        const safe = escapeFFmpegText(line);
        const yLine = `${yBase}+${idx * lineH}`;
        return (
          `drawtext=text='${safe}':fontsize=34:fontcolor=white` +
          `:x=(w-text_w)/2:y=${yLine}` +
          `:box=1:boxcolor=black@0.6:boxborderw=10` +
          `:shadowcolor=black@0.5:shadowx=2:shadowy=2` +
          `:enable='between(t,${safeStart.toFixed(2)},${safeEnd.toFixed(2)})'`
        );
      });
    });

    if (filters.length === 0) {
      return { success: false, error: "Segmen subtitle di luar durasi video." };
    }

    const vfChain = filters.join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${vfChain}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 240000);

    const base64  = await toBase64(outputPath, "video/mp4");
    const posLabel = { top: "atas", middle: "tengah", bottom: "bawah" }[position];
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `🎙️ Auto subtitle (${segments.length} segmen) di ${posLabel} berhasil! (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    logger.error({ err }, "Auto subtitle gagal");
    return { success: false, error: `Auto subtitle gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}
