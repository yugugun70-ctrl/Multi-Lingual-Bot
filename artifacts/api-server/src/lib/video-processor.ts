import { logger } from "./logger";
import { fetchBuffer, bufferToTempFile } from "./image-processor";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface VideoResult {
  success: boolean;
  outputUrl?: string;
  outputBuffer?: Buffer;
  outputBase64?: string;
  mimeType?: string;
  error?: string;
  message?: string;
  isVideo?: boolean;
}

// Temukan binary ffmpeg
function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

// Jalankan ffmpeg command
async function runFfmpeg(args: string[], timeoutMs = 120000): Promise<void> {
  const ffmpeg = getFfmpegPath();
  const cmd = `${ffmpeg} ${args.join(" ")}`;
  logger.info({ cmd }, "Menjalankan FFmpeg");
  
  const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
  if (stderr) logger.debug({ stderr: stderr.slice(0, 200) }, "FFmpeg stderr");
}

// Baca file output ke base64
async function fileToBase64(filePath: string, mime: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ─── Video Upscale via FFmpeg (scale up + sharpen) ──────────────────────────

export async function videoUpscaleFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_upscale_${Date.now()}.mp4`);
  
  try {
    // Scale 2x dengan filter unsharp untuk sharpness
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-vf", "scale=iw*2:ih*2:flags=lanczos,unsharp=5:5:1.0:5:5:0.0",
      "-c:v", "libx264", "-crf", "18", "-preset", "fast",
      "-c:a", "copy",
      `"${outputPath}"`,
    ]);
    
    const base64 = await fileToBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: "Video berhasil di-upscale 2x!" };
  } catch (err: any) {
    logger.error({ err }, "Video upscale gagal");
    return { success: false, error: `Video upscale gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Stabilize via FFmpeg (vidstab filter) ─────────────────────────────

export async function videoStabilizeFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const stabPath = path.join(os.tmpdir(), `editai_stab_${Date.now()}.trf`);
  const outputPath = path.join(os.tmpdir(), `editai_stable_${Date.now()}.mp4`);
  
  try {
    // Pass 1: analisis
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-vf", `vidstabdetect=shakiness=10:accuracy=15:result="${stabPath}"`,
      "-f", "null", "-",
    ]);
    
    // Pass 2: stabilisasi
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-vf", `vidstabtransform=input="${stabPath}":zoom=1:smoothing=30,unsharp=5:5:0.8:3:3:0.4`,
      "-c:v", "libx264", "-crf", "20", "-preset", "fast",
      "-c:a", "copy",
      `"${outputPath}"`,
    ]);
    
    const base64 = await fileToBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: "Video berhasil distabilkan!" };
  } catch (err: any) {
    logger.error({ err }, "Video stabilize gagal");
    return { success: false, error: `Video stabilize gagal: ${err.message}` };
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(stabPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {}),
    ]);
  }
}

// ─── Video Resize via FFmpeg ──────────────────────────────────────────────────

export async function videoResizeFFmpeg(videoUrl: string, width = 1280, height = 720): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_resize_${Date.now()}.mp4`);
  
  try {
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v", "libx264", "-crf", "22", "-preset", "fast",
      "-c:a", "copy",
      `"${outputPath}"`,
    ]);
    
    const base64 = await fileToBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video berhasil di-resize ke ${width}x${height}!` };
  } catch (err: any) {
    return { success: false, error: `Video resize gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Watermark via FFmpeg ───────────────────────────────────────────────

export async function videoWatermarkFFmpeg(videoUrl: string, text = "EditAI"): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_wm_${Date.now()}.mp4`);
  
  try {
    const safeText = text.replace(/'/g, "\\'").replace(/:/g, "\\:");
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-vf", `drawtext=text='${safeText}':fontsize=36:fontcolor=white@0.7:x=w-tw-20:y=h-th-20:shadowcolor=black@0.5:shadowx=2:shadowy=2`,
      "-c:v", "libx264", "-crf", "22", "-preset", "fast",
      "-c:a", "copy",
      `"${outputPath}"`,
    ]);
    
    const base64 = await fileToBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: "Watermark berhasil ditambahkan!" };
  } catch (err: any) {
    return { success: false, error: `Video watermark gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Noise Reduction via FFmpeg (hqdn3d filter) ────────────────────────

export async function videoNoiseReductionFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_denoise_${Date.now()}.mp4`);
  
  try {
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-vf", "hqdn3d=4:3:6:4.5",
      "-c:v", "libx264", "-crf", "20", "-preset", "fast",
      "-c:a", "copy",
      `"${outputPath}"`,
    ]);
    
    const base64 = await fileToBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: "Noise video berhasil dikurangi!" };
  } catch (err: any) {
    return { success: false, error: `Noise reduction gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Photo to Video via FFmpeg (Ken Burns effect) ────────────────────────────

export async function photoToVideoFFmpeg(
  imageUrl: string,
  type: "cinematic" | "zoom" | "pan"
): Promise<VideoResult> {
  const buf = await fetchBuffer(imageUrl);
  const inputPath = await bufferToTempFile(buf, "jpg");
  const outputPath = path.join(os.tmpdir(), `editai_p2v_${Date.now()}.mp4`);

  // Pre-upscale gambar ke ukuran besar agar zoom tidak blur
  let preparedPath = inputPath;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    const w = Math.max(meta.width ?? 1280, 1920);
    const h = Math.max(meta.height ?? 720, 1080);
    const upBuf = await sharp(buf).resize(w * 2, h * 2, { kernel: sharp.kernel.lanczos3 }).toBuffer();
    preparedPath = await bufferToTempFile(upBuf, "jpg");
  } catch {}

  try {
    // Efek Ken Burns berbeda per type
    const filters: Record<string, string> = {
      cinematic: "zoompan=z='if(lte(zoom,1.0),1.3,max(1.001,zoom-0.002))':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',scale=1280:720",
      zoom: "zoompan=z='min(zoom+0.0015,1.5)':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',scale=1280:720",
      pan: "zoompan=z='1.15':d=125:x='if(lte(on,1),0,x+1)':y='ih/2-(ih/zoom/2)',scale=1280:720",
    };

    await runFfmpeg([
      "-y", "-loop", "1", "-i", `"${preparedPath}"`,
      "-vf", filters[type],
      "-t", "5",
      "-c:v", "libx264", "-crf", "20", "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-r", "25",
      `"${outputPath}"`,
    ], 60000);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video ${type} berhasil dibuat dari foto!` };
  } catch (err: any) {
    logger.error({ err }, "Photo to video FFmpeg gagal");
    return { success: false, error: `Photo to video gagal: ${err.message}` };
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      preparedPath !== inputPath ? fs.unlink(preparedPath).catch(() => {}) : Promise.resolve(),
      fs.unlink(outputPath).catch(() => {}),
    ]);
  }
}
