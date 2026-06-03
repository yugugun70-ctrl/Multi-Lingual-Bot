import { logger } from "./logger";
import { fetchBuffer, bufferToTempFile } from "./image-processor";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SubtitleStyle, ManualSubtitleStyle, WatermarkPosition, WatermarkSize } from "../bot/state";
import type { TranscriptSegment } from "./transcribe";

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
  logger.info({ cmd: cmd.slice(0, 300) }, "FFmpeg");
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

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `✨ <b>Standar</b> selesai — lebih jernih, tajam &amp; warna hidup! (${dur.toFixed(0)}s)`,
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

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `💎 <b>Pro</b> selesai — kualitas tinggi, super tajam &amp; warna kaya! (${dur.toFixed(0)}s)`,
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
      "eq=contrast=1.2:saturation=1.5:brightness=-0.02:gamma=0.88",
      "unsharp=7:7:1.5:5:5:0.0",
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

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `🌈 <b>HDR</b> selesai — warna hidup, kontras dinamis &amp; tampilan premium! (${dur.toFixed(0)}s)\n<i>Simulasi HDR via pemrosesan video.</i>`,
    };
  } catch (err: any) {
    return { success: false, error: `HDR gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Tingkatkan Resolusi & Rasio ──────────────────────────────────────────────

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

    const targetHMap: Record<string, number | null> = { original: null, hd: 720, fhd: 1080, "4k": 2160 };
    const ratioMap: Record<string, [number, number] | null> = {
      "9_16": [9, 16], "1_1": [1, 1], "16_9": [16, 9], keep: null,
    };

    const tH  = targetHMap[resolution];
    const rWH = ratioMap[ratio];

    let filter: string;
    let targetW: number | null = null;
    let targetH: number | null = null;
    let didUpscale = false;

    if (rWH && tH) {
      const [rW, rH] = rWH;
      targetH = tH; targetW = makeEven(Math.round(tH * rW / rH));
      if (targetW > dims.w || targetH > dims.h) didUpscale = true;
      filter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${targetH}`;
    } else if (rWH && !tH) {
      const [rW, rH] = rWH;
      if (rW <= rH) {
        targetH = makeEven(Math.min(dims.h, Math.round(dims.w * rH / rW)));
        targetW = makeEven(Math.round(targetH * rW / rH));
      } else {
        targetW = makeEven(Math.min(dims.w, Math.round(dims.h * rW / rH)));
        targetH = makeEven(Math.round(targetW * rH / rW));
      }
      filter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${targetH}`;
    } else if (!rWH && tH) {
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

    const resLabel = { original: "Original", hd: "HD 720p", fhd: "Full HD 1080p", "4k": "4K 2160p" }[resolution];
    const ratLabel = { "9_16": "9:16", "1_1": "1:1", "16_9": "16:9", keep: "Asli" }[ratio];
    const dimInfo  = targetW && targetH ? ` (${targetW}×${targetH})` : targetH ? ` (×${targetH}p)` : "";
    const upNote   = didUpscale ? "\n<i>ℹ️ Upscale tidak menambah detail asli.</i>" : "";

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `📺 <b>${resLabel} · ${ratLabel}</b>${dimInfo} — selesai! (${dur.toFixed(0)}s)${upNote}`,
    };
  } catch (err: any) {
    return { success: false, error: `Resolusi/Rasio gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Hapus Watermark ──────────────────────────────────────────────────────────

export async function videoRemoveWatermarkFFmpeg(
  videoUrl: string,
  position: WatermarkPosition,
  size: WatermarkSize = "medium"
): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_wm_${Date.now()}.mp4`);

  try {
    const dur  = await getDuration(inputPath);
    const dims = await getVideoDimensions(inputPath);
    const { w: vW, h: vH } = dims;

    // Ukuran area watermark dalam piksel (berdasarkan % video)
    const sizeMap: Record<WatermarkSize, [number, number]> = {
      small:  [Math.round(vW * 0.12), Math.round(vH * 0.09)],
      medium: [Math.round(vW * 0.22), Math.round(vH * 0.14)],
      large:  [Math.round(vW * 0.32), Math.round(vH * 0.19)],
    };
    const [wmW, wmH] = sizeMap[size];
    const margin = Math.round(Math.min(vW, vH) * 0.02); // 2% margin dari tepi

    // Posisi titik awal (x,y) setiap preset
    const posMap: Record<WatermarkPosition, [number, number]> = {
      top_left:     [margin,             margin],
      top_right:    [vW - wmW - margin,  margin],
      bottom_left:  [margin,             vH - wmH - margin],
      bottom_right: [vW - wmW - margin,  vH - wmH - margin],
      center:       [Math.round((vW - wmW) / 2), Math.round((vH - wmH) / 2)],
    };
    const [x, y] = posMap[position];

    // Gunakan delogo (interpolasi bilateral) untuk menghapus logo/watermark
    const filter = `delogo=x=${x}:y=${y}:w=${wmW}:h=${wmH}:show=0`;

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filter}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "copy",
      `"${outputPath}"`,
    ], 200000);

    const posLabel: Record<WatermarkPosition, string> = {
      top_left: "Kiri Atas", top_right: "Kanan Atas",
      bottom_left: "Kiri Bawah", bottom_right: "Kanan Bawah",
      center: "Tengah",
    };
    const sizeLabel: Record<WatermarkSize, string> = {
      small: "Kecil (S)", medium: "Sedang (M)", large: "Besar (L)",
    };

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `🗑️ <b>Watermark dihapus!</b>\n📍 Posisi: ${posLabel[position]} | Ukuran: ${sizeLabel[size]}\n<i>Area: ${wmW}×${wmH}px direkonstruksi. Jika hasilnya kurang sempurna, coba posisi/ukuran lain.</i>`,
    };
  } catch (err: any) {
    logger.error({ err }, "Watermark removal failed");
    return { success: false, error: `Hapus watermark gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Subtitle Otomatis — Configs & Helper ─────────────────────────────────────

interface SubStyleCfg {
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

const AUTO_SUBTITLE_STYLES: Record<SubtitleStyle, SubStyleCfg> = {
  classic: {
    fontsize: 34, fontcolor: "white", boxcolor: "black@0.55", boxborderw: 10,
    shadowcolor: "black@0.5", shadowx: 2, shadowy: 2, lineH: 42, maxChars: 38,
  },
  tiktok: {
    fontsize: 44, fontcolor: "white", boxcolor: "black@0.85", boxborderw: 22,
    lineH: 56, maxChars: 28,
  },
  capcut: {
    fontsize: 38, fontcolor: "white", boxcolor: "black@0.50", boxborderw: 14,
    shadowcolor: "black@0.65", shadowx: 1, shadowy: 1, lineH: 48, maxChars: 33,
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

function escFF(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

// ─── Auto Subtitle ────────────────────────────────────────────────────────────

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
    if (segments.length === 0) return { success: false, error: "Tidak ada segmen subtitle." };

    const cfg = AUTO_SUBTITLE_STYLES[style];

    const filters: string[] = segments.flatMap((seg) => {
      const s = Math.max(0, seg.start);
      const e = Math.min(seg.end, dur);
      if (e <= s) return [];

      const lines  = wrapText(seg.text, cfg.maxChars);
      const totalH = lines.length * cfg.lineH;

      let yBase: string;
      switch (position) {
        case "top":    yBase = `h*0.05`; break;
        case "middle": yBase = `(h-${totalH})/2`; break;
        case "custom": yBase = `(h-${totalH})*${(Math.max(0, Math.min(100, customYPercent)) / 100).toFixed(3)}`; break;
        default:       yBase = `h-${totalH}-40`;
      }

      return lines.map((line, idx) => {
        const safe  = escFF(line);
        const yLine = idx === 0 ? yBase : `${yBase}+${idx * cfg.lineH}`;
        let dt = (
          `drawtext=text='${safe}'` +
          `:fontsize=${cfg.fontsize}:fontcolor=${cfg.fontcolor}` +
          `:x=(w-text_w)/2:y=${yLine}` +
          `:box=1:boxcolor=${cfg.boxcolor}:boxborderw=${cfg.boxborderw}` +
          `:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'`
        );
        if (cfg.shadowcolor) dt += `:shadowcolor=${cfg.shadowcolor}:shadowx=${cfg.shadowx}:shadowy=${cfg.shadowy}`;
        return dt;
      });
    });

    if (filters.length === 0) return { success: false, error: "Semua segmen di luar durasi video." };

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filters.join(",")}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 300000);

    const styleLabel = { classic: "Classic 📝", tiktok: "TikTok Style 📱", capcut: "CapCut Style 🎬" }[style];
    const posLabel   = { top: "Atas", middle: "Tengah", bottom: "Bawah", custom: `Kustom ${customYPercent}%` }[position];

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `🎙️ <b>Subtitle ${styleLabel}</b> — ${segments.length} segmen, posisi ${posLabel}! (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    logger.error({ err }, "Auto subtitle gagal");
    return { success: false, error: `Subtitle gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Manual Subtitle — Gaya Configs ──────────────────────────────────────────

interface ManualStyleCfg {
  fontsize: number;
  fontcolor: string;
  borderw: number;
  bordercolor: string;
  boxcolor?: string;
  boxborderw?: number;
  shadowcolor?: string;
  shadowx?: number;
  shadowy?: number;
  fullBar?: boolean;   // tambahkan drawbox background penuh
  lineH: number;
}

const MANUAL_SUBTITLE_STYLES: Record<ManualSubtitleStyle, ManualStyleCfg> = {
  bold_white: {
    fontsize: 40, fontcolor: "white",
    borderw: 3, bordercolor: "000000",
    shadowcolor: "black@0.6", shadowx: 3, shadowy: 3,
    lineH: 50,
  },
  tiktok_yellow: {
    fontsize: 46, fontcolor: "white",
    borderw: 4, bordercolor: "FFD700",
    boxcolor: "black@0.80", boxborderw: 22,
    lineH: 58,
  },
  neon_orange: {
    fontsize: 42, fontcolor: "FFA500",
    borderw: 3, bordercolor: "000000",
    shadowcolor: "FFA500@0.5", shadowx: 0, shadowy: 4,
    lineH: 52,
  },
  capcut_minimal: {
    fontsize: 38, fontcolor: "white",
    borderw: 2, bordercolor: "00000099",
    shadowcolor: "black@0.35", shadowx: 1, shadowy: 2,
    lineH: 48,
  },
  cinematic: {
    fontsize: 36, fontcolor: "white",
    borderw: 0, bordercolor: "000000",
    boxcolor: "000000@0.92", boxborderw: 28,
    fullBar: true,
    lineH: 50,
  },
};

function buildManualDrawtext(
  line: string,
  cfg: ManualStyleCfg,
  yExpr: string,
  dur: number
): string {
  const safe = escFF(line);
  let dt = (
    `drawtext=text='${safe}'` +
    `:fontsize=${cfg.fontsize}:fontcolor=${cfg.fontcolor}` +
    `:x=(w-text_w)/2:y=${yExpr}` +
    `:borderw=${cfg.borderw}:bordercolor=${cfg.bordercolor}` +
    `:enable='between(t,0,${dur.toFixed(2)})'`
  );
  if (cfg.boxcolor) dt += `:box=1:boxcolor=${cfg.boxcolor}:boxborderw=${cfg.boxborderw ?? 14}`;
  if (cfg.shadowcolor) dt += `:shadowcolor=${cfg.shadowcolor}:shadowx=${cfg.shadowx ?? 2}:shadowy=${cfg.shadowy ?? 2}`;
  return dt;
}

// ─── Manual Subtitle (Teks Statis + Gaya Keren) ───────────────────────────────

export async function videoManualSubtitleFFmpeg(
  videoUrl: string,
  text: string,
  style: ManualSubtitleStyle = "bold_white",
  position: "top" | "middle" | "bottom" = "bottom"
): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_mansub_${Date.now()}.mp4`);

  try {
    const dur  = await getDuration(inputPath);
    const cfg  = MANUAL_SUBTITLE_STYLES[style];

    // Pecah teks per baris (\n atau \n\n)
    const rawLines = text.split(/\\n|\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return { success: false, error: "Teks kosong." };

    const totalH = rawLines.length * cfg.lineH;

    // Kalkulasi y base
    let yBase: string;
    switch (position) {
      case "top":    yBase = `h*0.06`; break;
      case "middle": yBase = `(h-${totalH})/2`; break;
      default:       yBase = `h-${totalH}-50`; // bottom
    }

    const filters: string[] = [];

    // Untuk gaya "cinematic" tambahkan bar hitam penuh di belakang teks
    if (cfg.fullBar) {
      const barH = totalH + 60;
      let barY: string;
      switch (position) {
        case "top":    barY = "0"; break;
        case "middle": barY = `(h-${barH})/2`; break;
        default:       barY = `h-${barH}`;
      }
      filters.push(`drawbox=x=0:y=${barY}:w=iw:h=${barH}:color=${cfg.boxcolor ?? "black@0.92"}:t=fill:enable='between(t,0,${dur.toFixed(2)})'`);
    }

    // Tambahkan satu drawtext per baris
    rawLines.forEach((line, idx) => {
      const yLine = idx === 0 ? yBase : `${yBase}+${idx * cfg.lineH}`;
      filters.push(buildManualDrawtext(line, cfg, yLine, dur));
    });

    if (filters.length === 0) return { success: false, error: "Tidak ada teks yang bisa ditempel." };

    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"${filters.join(",")}"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "copy",
      `"${outputPath}"`,
    ], 200000);

    const styleLabel: Record<ManualSubtitleStyle, string> = {
      bold_white: "Bold White ✨", tiktok_yellow: "TikTok Yellow 💛",
      neon_orange: "Neon Orange 🔥", capcut_minimal: "CapCut Minimal 💎",
      cinematic: "Cinematic 🎬",
    };
    const posLabel = { top: "Atas", middle: "Tengah", bottom: "Bawah" }[position];

    return {
      success: true, outputUrl: await toBase64(outputPath, "video/mp4"), mimeType: "video/mp4", isVideo: true,
      message: `✏️ <b>Teks Manual — ${styleLabel[style]}</b>\nPosisi: ${posLabel} | ${rawLines.length} baris (${dur.toFixed(0)}s)`,
    };
  } catch (err: any) {
    logger.error({ err }, "Manual subtitle gagal");
    return { success: false, error: `Teks manual gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}
