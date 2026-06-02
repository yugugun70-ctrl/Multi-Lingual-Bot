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
  outputBuffer?: Buffer;
  outputBase64?: string;
  mimeType?: string;
  error?: string;
  message?: string;
  isVideo?: boolean;
}

// Durasi maksimum video output (detik)
const MAX_DURATION_SEC = 30;

// Temukan binary ffmpeg
function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

// Jalankan ffmpeg command
async function runFfmpeg(args: string[], timeoutMs = 180000): Promise<void> {
  const ffmpeg = getFfmpegPath();
  const cmd = `${ffmpeg} ${args.join(" ")}`;
  logger.info({ cmd }, "Menjalankan FFmpeg");
  const { stderr } = await execAsync(cmd, { timeout: timeoutMs });
  if (stderr) logger.debug({ stderr: stderr.slice(0, 200) }, "FFmpeg stderr");
}

// Baca file output ke base64
async function fileToBase64(filePath: string, mime: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Dapatkan durasi video (detik)
async function getVideoDuration(inputPath: string): Promise<number> {
  try {
    const ffprobe = getFfmpegPath().replace("ffmpeg", "ffprobe");
    const { stdout } = await execAsync(
      `${ffprobe} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
    );
    return Math.min(parseFloat(stdout.trim()) || MAX_DURATION_SEC, MAX_DURATION_SEC);
  } catch {
    return MAX_DURATION_SEC;
  }
}

// ─── Video Upscale via FFmpeg (scale up + sharpen, max 30s) ──────────────────

export async function videoUpscaleFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_upscale_${Date.now()}.mp4`);

  try {
    const dur = await getVideoDuration(inputPath);
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      // Scale 2x Lanczos + unsharp mask untuk detail tajam
      "-vf", "scale=iw*2:ih*2:flags=lanczos,unsharp=5:5:1.5:5:5:0.0",
      "-c:v", "libx264",
      // CRF 15 = kualitas sangat tinggi (0 = lossless, 51 = terburuk)
      "-crf", "15",
      "-preset", "slow",
      "-profile:v", "high",
      "-level", "4.1",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Video di-upscale 2x (kualitas ultra, max ${dur.toFixed(0)}s)!`,
    };
  } catch (err: any) {
    logger.error({ err }, "Video upscale gagal");
    return { success: false, error: `Video upscale gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Enhance via FFmpeg (jernih, tajam, warna hidup) ───────────────────

export async function videoEnhanceFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_enhance_${Date.now()}.mp4`);

  try {
    const dur = await getVideoDuration(inputPath);
    // Pipeline: hapus noise → tajamkan → tingkatkan kontras & saturasi
    const filterChain = [
      "hqdn3d=2:1.5:3:2.5",                               // denoise halus
      "unsharp=5:5:1.2:3:3:0.5",                          // sharpen
      "eq=contrast=1.05:saturation=1.15:brightness=0.02", // color boost
      "scale=iw:ih:flags=lanczos",                         // resample bersih
    ].join(",");

    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      "-vf", filterChain,
      "-c:v", "libx264",
      "-crf", "16",
      "-preset", "slow",
      "-profile:v", "high",
      "-level", "4.1",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Video ditingkatkan: lebih jernih, tajam & warna hidup (max ${dur.toFixed(0)}s)!`,
    };
  } catch (err: any) {
    logger.error({ err }, "Video enhance gagal");
    return { success: false, error: `Video enhance gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Stabilize via FFmpeg (vidstab, max 30s) ───────────────────────────

export async function videoStabilizeFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const stabPath = path.join(os.tmpdir(), `editai_stab_${Date.now()}.trf`);
  const outputPath = path.join(os.tmpdir(), `editai_stable_${Date.now()}.mp4`);

  try {
    const dur = await getVideoDuration(inputPath);

    // Pass 1: analisis getaran
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      "-vf", `vidstabdetect=shakiness=10:accuracy=15:result="${stabPath}"`,
      "-f", "null", "-",
    ]);

    // Pass 2: stabilisasi + sharpen
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      "-vf", `vidstabtransform=input="${stabPath}":zoom=1:smoothing=30,unsharp=5:5:1.0:3:3:0.4`,
      "-c:v", "libx264",
      "-crf", "17",
      "-preset", "slow",
      "-profile:v", "high",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Video distabilkan dan dipertajam (max ${dur.toFixed(0)}s)!`,
    };
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

// ─── Video Resize via FFmpeg (max 30s) ───────────────────────────────────────

export async function videoResizeFFmpeg(videoUrl: string, width = 1280, height = 720): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_resize_${Date.now()}.mp4`);

  try {
    const dur = await getVideoDuration(inputPath);
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "slow",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Video di-resize ke ${width}x${height} (max ${dur.toFixed(0)}s)!`,
    };
  } catch (err: any) {
    return { success: false, error: `Video resize gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Watermark via FFmpeg (max 30s) ────────────────────────────────────

export async function videoWatermarkFFmpeg(videoUrl: string, text = "EditAI"): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_wm_${Date.now()}.mp4`);

  try {
    const dur = await getVideoDuration(inputPath);
    const safeText = text.replace(/'/g, "\\'").replace(/:/g, "\\:");
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      "-vf", `drawtext=text='${safeText}':fontsize=36:fontcolor=white@0.75:x=w-tw-20:y=h-th-20:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "fast",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Watermark ditambahkan (max ${dur.toFixed(0)}s)!`,
    };
  } catch (err: any) {
    return { success: false, error: `Video watermark gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Video Noise Reduction via FFmpeg (max 30s) ──────────────────────────────

export async function videoNoiseReductionFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_denoise_${Date.now()}.mp4`);

  try {
    const dur = await getVideoDuration(inputPath);
    await runFfmpeg([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      // nlmeans lebih halus dari hqdn3d, tidak blur
      "-vf", "nlmeans=s=3:p=3:pc=3:r=5,unsharp=3:3:0.8",
      "-c:v", "libx264",
      "-crf", "17",
      "-preset", "slow",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Noise video dikurangi (kualitas crystal clear, max ${dur.toFixed(0)}s)!`,
    };
  } catch (err: any) {
    return { success: false, error: `Noise reduction gagal: ${err.message}` };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Photo to Video via FFmpeg (Ken Burns, 30s, kualitas sinematik) ───────────

export async function photoToVideoFFmpeg(
  imageUrl: string,
  type: "cinematic" | "zoom" | "pan"
): Promise<VideoResult> {
  const buf = await fetchBuffer(imageUrl);
  const inputPath = await bufferToTempFile(buf, "jpg");
  const outputPath = path.join(os.tmpdir(), `editai_p2v_${Date.now()}.mp4`);

  // Pre-upscale gambar 3x agar tidak blur saat zoom animasi
  let preparedPath = inputPath;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    const targetW = Math.max(meta.width ?? 1920, 2560);
    const targetH = Math.max(meta.height ?? 1080, 1440);
    const upBuf = await sharp(buf)
      .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: "inside" })
      .sharpen({ sigma: 0.8 })
      .jpeg({ quality: 98 })
      .toBuffer();
    preparedPath = await bufferToTempFile(upBuf, "jpg");
  } catch {}

  try {
    const durSec = MAX_DURATION_SEC; // selalu 30 detik
    const fps = 30;
    const totalFrames = durSec * fps;

    // Filter Ken Burns per type — output 1920x1080, 30fps, 30 detik
    const filters: Record<string, string> = {
      // Cinematic: zoom in perlahan dari 1.0 → 1.4
      cinematic: `zoompan=z='if(lte(zoom,1.0),1.0,min(zoom+0.0013,1.4))':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${fps}`,
      // Zoom: zoom in terus sampai 1.6
      zoom: `zoompan=z='min(zoom+0.0015,1.6)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${fps}`,
      // Pan: geser dari kiri ke kanan dengan zoom 1.2
      pan: `zoompan=z='1.2':d=${totalFrames}:x='if(lte(on,1),0,min(x+iw/zoom/${totalFrames}*0.5,iw-iw/zoom))':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${fps}`,
    };

    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-framerate", String(fps),
      "-i", `"${preparedPath}"`,
      "-vf", filters[type],
      "-t", String(durSec),
      "-c:v", "libx264",
      // CRF 16 = kualitas tinggi, terlihat jernih di semua resolusi
      "-crf", "16",
      "-preset", "slow",
      "-profile:v", "high",
      "-level", "4.2",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      // Tambah audio diam agar kompatibel dengan semua player
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-c:a", "aac", "-b:a", "128k", "-shortest",
      `"${outputPath}"`,
    ], 240000);

    const base64 = await fileToBase64(outputPath, "video/mp4");
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `✅ Video ${type} 30 detik (1080p, 30fps) berhasil dibuat dari foto!`,
    };
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
