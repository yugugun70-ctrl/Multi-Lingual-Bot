import { logger } from "./logger";
import { fetchBuffer, bufferToTempFile } from "./image-processor";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SubtitleStyle } from "../bot/state";

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

function makeEven(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v + 1;
}

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

async function getVideoDimensions(inputPath: string): Promise<{ w: number; h: number }> {
  try {
    const { stdout } = await execAsync(
      `${ffprobe()} -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const parts = stdout.trim().split(",");
    return { w: parseInt(parts[0]) || 1920, h: parseInt(parts[1]) || 1080 };
  } catch {
    return { w: 1920, h: 1080 };
  }
}

async function cleanup(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
}

// ─── Perbaiki Video: Standar ───────────────────────────────────────────────────

export async function videoEnhanceStandardFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_std_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    const filter = [
      "hqdn3d=1:0.8:2:1.5",
      "unsharp=3:3:0.8:3:3:0.3",
      "eq=contrast=1.05:saturation=1.08:brightness=0.01",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "20", "-preset", "fast",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `✨ Video diperbaiki (Standar) — lebih jernih, tajam & warna hidup! (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    return { success: false, error: `Perbaiki Standar gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Perbaiki Video: Pro ───────────────────────────────────────────────────────

export async function videoEnhanceProFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_pro_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    const filter = [
      "hqdn3d=2:1.5:3:2.5",
      "unsharp=5:5:1.5:3:3:0.6",
      "eq=contrast=1.10:saturation=1.25:brightness=0.02",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "17", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `💎 Video diperbaiki (Pro) — kualitas tinggi, super tajam & warna kaya! (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    return { success: false, error: `Perbaiki Pro gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Perbaiki Video: HDR ───────────────────────────────────────────────────────

export async function videoEnhanceHDRFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_hdr_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    const filter = [
      // Simulasi HDR: boost kontras & saturasi, gamma untuk area gelap lebih jelas
      "eq=contrast=1.2:saturation=1.5:brightness=-0.02:gamma=0.88",
      // Sharpen untuk detil lebih jelas
      "unsharp=7:7:1.5:5:5:0.0",
      // Pastikan dimensi genap
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "17", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `🌈 Efek HDR diterapkan — warna hidup, kontras dinamis & tampilan premium! (${dur.toFixed(0)}s)\n<i>ℹ️ Simulasi HDR via pemrosesan, bukan HDR kamera asli.</i>`,
    };
  } catch (err: any) {
    return { success: false, error: `HDR gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Tingkatkan Resolusi & Rasio (Kombinasi) ──────────────────────────────────

export async function videoResolutionRatioFFmpeg(
  videoUrl: string,
  resolution: "original" | "hd" | "fhd" | "4k",
  ratio: "9_16" | "1_1" | "16_9" | "keep"
): Promise<VideoResult> {
  if (resolution === "original" && ratio === "keep") {
    return { success: false, error: "Pilih resolusi atau rasio yang berbeda dari aslinya." };
  }

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_resrat_${Date.now()}.mp4`);

  try {
    const dur  = await getDuration(inputPath);
    const dims = await getVideoDimensions(inputPath);

    // Target height per resolusi
    const targetHMap: Record<string, number | null> = {
      original: null, hd: 720, fhd: 1080, "4k": 2160,
    };
    // Target aspect ratio
    const ratioMap: Record<string, [number, number] | null> = {
      "9_16": [9, 16], "1_1": [1, 1], "16_9": [16, 9], keep: null,
    };

    const tH    = targetHMap[resolution];
    const rWH   = ratioMap[ratio];

    let filter: string;
    let targetW: number | null = null;
    let targetH: number | null = null;
    let didUpscale = false;

    if (rWH && tH) {
      // Spesifik rasio + spesifik resolusi → scale to fill + crop center
      const [rW, rH] = rWH;
      targetH = tH;
      targetW = makeEven(Math.round(tH * rW / rH));
      if (targetW > dims.w || targetH > dims.h) didUpscale = true;
      filter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${targetH}`;
    } else if (rWH && !tH) {
      // Hanya rasio, pertahankan ukuran asli
      const [rW, rH] = rWH;
      // Hitung dimensi yang cocok dari video input
      if (rW <= rH) {
        // Portrait / square: tinggi = max, lebar menyesuaikan
        targetH = makeEven(Math.min(dims.h, Math.round(dims.w * rH / rW)));
        targetW = makeEven(Math.round(targetH * rW / rH));
      } else {
        // Landscape: lebar = max, tinggi menyesuaikan
        targetW = makeEven(Math.min(dims.w, Math.round(dims.h * rW / rH)));
        targetH = makeEven(Math.round(targetW * rH / rW));
      }
      filter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${targetH}`;
    } else if (!rWH && tH) {
      // Hanya resolusi, pertahankan rasio asli
      targetH = tH;
      if (tH > dims.h) didUpscale = true;
      filter = `scale=-2:${tH}:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    } else {
      return { success: false, error: "Tidak ada perubahan yang valid." };
    }

    const crf = resolution === "4k" ? 20 : resolution === "fhd" ? 18 : resolution === "hd" ? 20 : 18;

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", String(crf), "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 240000);

    const resLabel  = { original: "Original", hd: "HD 720p", fhd: "Full HD 1080p", "4k": "4K 2160p" }[resolution];
    const ratLabel  = { "9_16": "9:16", "1_1": "1:1", "16_9": "16:9", keep: "Asli" }[ratio];
    const dimInfo   = targetW && targetH ? ` (${targetW}×${targetH})` : targetH ? ` (×${targetH}p)` : "";
    const upscaleNote = didUpscale ? "\n<i>ℹ️ Upscale tidak menambah detail asli seperti AI enhancement.</i>" : "";

    const base64 = await toBase64(outputPath, "video/mp4");
    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `📺 ${resLabel} · ${ratLabel}${dimInfo} — selesai! (${dur.toFixed(0)}s)${upscaleNote}`,
    };
  } catch (err: any) {
    return { success: false, error: `Resolusi/Rasio gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Auto Subtitle — Style Configs ───────────────────────────────────────────

import type { TranscriptSegment } from "./transcribe";

interface StyleConfig {
  fontsize: number;
  fontcolor: string;
  boxcolor: string;
  boxborderw: number;
  shadowcolor?: string;
  shadowx?: number;
  shadowy?: number;
  lineH: number;
  maxChars: number;
}

const SUBTITLE_STYLES: Record<SubtitleStyle, StyleConfig> = {
  classic: {
    fontsize: 34,
    fontcolor: "white",
    boxcolor: "black@0.55",
    boxborderw: 10,
    shadowcolor: "black@0.5",
    shadowx: 2,
    shadowy: 2,
    lineH: 42,
    maxChars: 38,
  },
  tiktok: {
    fontsize: 44,
    fontcolor: "white",
    boxcolor: "black@0.85",
    boxborderw: 22,
    lineH: 56,
    maxChars: 28,
  },
  capcut: {
    fontsize: 38,
    fontcolor: "white",
    boxcolor: "black@0.50",
    boxborderw: 14,
    shadowcolor: "black@0.65",
    shadowx: 1,
    shadowy: 1,
    lineH: 48,
    maxChars: 33,
  },
};

function wrapText(text: string, maxChars: number): string[] {
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

// ─── Auto Subtitle (Timed, dengan gaya) ──────────────────────────────────────

export async function videoAutoSubtitleFFmpeg(
  videoUrl: string,
  segments: TranscriptSegment[],
  position: "top" | "middle" | "bottom" | "custom" = "bottom",
  style: SubtitleStyle = "classic",
  customYPercent: number = 85
): Promise<VideoResult> {

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_autosub_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    if (segments.length === 0) {
      return { success: false, error: "Tidak ada segmen subtitle." };
    }

    const cfg = SUBTITLE_STYLES[style];

    const filters: string[] = segments.flatMap((seg) => {
      const safeStart = Math.max(0, seg.start);
      const safeEnd   = Math.min(seg.end, dur);
      if (safeEnd <= safeStart) return [];

      const lines  = wrapText(seg.text, cfg.maxChars);
      const totalH = lines.length * cfg.lineH;

      // Kalkulasi y position
      let yBase: string;
      switch (position) {
        case "top":    yBase = `h*0.05`; break;
        case "middle": yBase = `(h-${totalH})/2`; break;
        case "custom": yBase = `(h-${totalH})*${(Math.max(0, Math.min(100, customYPercent)) / 100).toFixed(3)}`; break;
        default:       yBase = `h-${totalH}-40`; // bottom
      }

      return lines.map((line, idx) => {
        const safe  = escapeFFmpegText(line);
        const yLine = idx === 0 ? yBase : `${yBase}+${idx * cfg.lineH}`;
        let drawtext = (
          `drawtext=text='${safe}'` +
          `:fontsize=${cfg.fontsize}` +
          `:fontcolor=${cfg.fontcolor}` +
          `:x=(w-text_w)/2:y=${yLine}` +
          `:box=1:boxcolor=${cfg.boxcolor}:boxborderw=${cfg.boxborderw}` +
          `:enable='between(t,${safeStart.toFixed(2)},${safeEnd.toFixed(2)})'`
        );
        if (cfg.shadowcolor) {
          drawtext += `:shadowcolor=${cfg.shadowcolor}:shadowx=${cfg.shadowx}:shadowy=${cfg.shadowy}`;
        }
        return drawtext;
      });
    });

    if (filters.length === 0) {
      return { success: false, error: "Semua segmen di luar durasi video." };
    }

    const vfChain = filters.join(",");
    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${vfChain}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 300000);

    const base64 = await toBase64(outputPath, "video/mp4");
    const styleLabel = { classic: "Classic", tiktok: "TikTok Style", capcut: "CapCut Style" }[style];
    const posLabel   = { top: "Atas", middle: "Tengah", bottom: "Bawah", custom: `Kustom (${customYPercent}%)` }[position];

    return {
      success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true,
      message: `🎙️ Subtitle <b>${styleLabel}</b> — ${segments.length} segmen di ${posLabel}! (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    logger.error({ err }, "Auto subtitle gagal");
    return { success: false, error: `Subtitle gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}
