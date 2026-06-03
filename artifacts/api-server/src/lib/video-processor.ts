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

const MAX_DURATION_SEC = 30;

function ffmpeg(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

function ffprobe(): string {
  return (process.env.FFMPEG_PATH ?? "ffmpeg").replace("ffmpeg", "ffprobe");
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

async function cleanup(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
}

// ─── Photo to Video (Ken Burns) ───────────────────────────────────────────────
// Durasi 15 detik, 720p, preset medium untuk kecepatan reasonable

export async function photoToVideoFFmpeg(
  imageUrl: string,
  type: "cinematic" | "zoom" | "pan"
): Promise<VideoResult> {
  const buf = await fetchBuffer(imageUrl);

  // Pre-upscale supaya tidak blur saat zoom
  let inputBuf = buf;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    const w = Math.max(meta.width ?? 1280, 1920);
    const h = Math.max(meta.height ?? 720, 1080);
    inputBuf = await sharp(buf)
      .resize(w, h, { kernel: sharp.kernel.lanczos3, fit: "inside" })
      .sharpen({ sigma: 0.5 })
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch { /* pakai original */ }

  const inputPath = await bufferToTempFile(inputBuf, "jpg");
  const outputPath = path.join(os.tmpdir(), `editai_p2v_${Date.now()}.mp4`);

  try {
    const durSec = 15;
    const fps    = 25;
    const frames = durSec * fps;  // 375 frames

    // Filter per type — skala ke 1280x720 dulu, lalu zoompan
    // PENTING: zoom harus mulai dari 1.0 dan increment per frame
    const zoomFilters: Record<string, string> = {
      // Zoom in perlahan: 1.0 → 1.3 selama 375 frame
      cinematic: [
        "scale=iw*2:ih*2:flags=lanczos",
        `zoompan=z='min(zoom+0.0008,1.3)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`,
        "unsharp=3:3:0.8",
      ].join(","),

      // Zoom in lebih cepat: 1.0 → 1.5
      zoom: [
        "scale=iw*2:ih*2:flags=lanczos",
        `zoompan=z='min(zoom+0.0013,1.5)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`,
        "unsharp=3:3:0.8",
      ].join(","),

      // Pan dari kiri ke kanan, zoom tetap 1.2
      pan: [
        "scale=iw*2:ih*2:flags=lanczos",
        `zoompan=z='1.2':d=${frames}:x='min(x+iw/zoom/${frames}*0.4,iw-iw/zoom)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`,
        "unsharp=3:3:0.8",
      ].join(","),
    };

    // ⚠️ PENTING: -f lavfi -i anullsrc HARUS sebelum -vf
    await runFF([
      "-y",
      "-loop", "1",
      "-i", `"${inputPath}"`,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-vf", `"${zoomFilters[type]}"`,
      "-c:v", "libx264",
      "-crf", "22",
      "-preset", "medium",
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(durSec),
      "-shortest",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    const typeLabel = { cinematic: "Sinematik", zoom: "Zoom In", pan: "Pan" }[type];
    return {
      success: true,
      outputUrl: base64,
      mimeType: "video/mp4",
      isVideo: true,
      message: `Video ${typeLabel} ${durSec}s (720p, 25fps) berhasil dibuat!`,
    };
  } catch (err: any) {
    logger.error({ err }, "Photo-to-video gagal");
    return { success: false, error: `Photo to video gagal: ${err.message?.slice(0, 100)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Enhance ────────────────────────────────────────────────────────────

export async function videoEnhanceFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_enhance_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    const filter = [
      "hqdn3d=2:1.5:3:2.5",                              // denoise halus
      "unsharp=5:5:1.5:3:3:0.5",                         // sharpen
      "eq=contrast=1.08:saturation=1.2:brightness=0.02", // color boost
      "scale=iw:ih:flags=lanczos",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
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

// ─── Video Upscale ────────────────────────────────────────────────────────────

export async function videoUpscaleFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_upscale_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    await runFF([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
      "-vf", `"scale=iw*2:ih*2:flags=lanczos,unsharp=5:5:1.5:5:5:0.0"`,
      "-c:v", "libx264", "-crf", "16", "-preset", "medium",
      "-profile:v", "high", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ], 180000);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video di-upscale 2x resolusi (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Video upscale gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Stabilize ──────────────────────────────────────────────────────────

export async function videoStabilizeFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const stabPath  = path.join(os.tmpdir(), `editai_stab_${Date.now()}.trf`);
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

// ─── Video Resize ─────────────────────────────────────────────────────────────

export async function videoResizeFFmpeg(videoUrl: string, width = 1280, height = 720): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_resize_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    await runFF([
      "-y", "-i", `"${inputPath}"`, "-t", String(dur),
      "-vf", `"scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2"`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium",
      "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k",
      `"${outputPath}"`,
    ]);

    const base64 = await toBase64(outputPath, "video/mp4");
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Video di-resize ke ${width}x${height} (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Video resize gagal: ${err.message?.slice(0, 80)}` };
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
