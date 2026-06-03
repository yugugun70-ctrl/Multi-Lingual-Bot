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

export async function photoToVideoFFmpeg(
  imageUrl: string,
  type: "cinematic" | "zoom" | "pan"
): Promise<VideoResult> {
  const buf = await fetchBuffer(imageUrl);

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

  const inputPath  = await bufferToTempFile(inputBuf, "jpg");
  const outputPath = path.join(os.tmpdir(), `editai_p2v_${Date.now()}.mp4`);

  try {
    const durSec = 15;
    const fps    = 25;
    const frames = durSec * fps;

    const zoomFilters: Record<string, string> = {
      cinematic: [
        "scale=iw*2:ih*2:flags=lanczos",
        `zoompan=z='min(zoom+0.0008,1.3)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`,
        "unsharp=3:3:0.8",
      ].join(","),
      zoom: [
        "scale=iw*2:ih*2:flags=lanczos",
        `zoompan=z='min(zoom+0.0013,1.5)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`,
        "unsharp=3:3:0.8",
      ].join(","),
      pan: [
        "scale=iw*2:ih*2:flags=lanczos",
        `zoompan=z='1.2':d=${frames}:x='min(x+iw/zoom/${frames}*0.4,iw-iw/zoom)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`,
        "unsharp=3:3:0.8",
      ].join(","),
    };

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

    const base64    = await toBase64(outputPath, "video/mp4");
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

// ─── Video Enhance (Jernihkan) ────────────────────────────────────────────────

export async function videoEnhanceFFmpeg(videoUrl: string): Promise<VideoResult> {
  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_enhance_${Date.now()}.mp4`);

  try {
    const dur    = await getDuration(inputPath);
    const filter = [
      "hqdn3d=2:1.5:3:2.5",
      "unsharp=5:5:1.5:3:3:0.5",
      "eq=contrast=1.08:saturation=1.2:brightness=0.02",
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

// ─── Video Quality / Upscale ke resolusi target ───────────────────────────────

export async function videoQualityFFmpeg(
  videoUrl: string,
  preset: "hd" | "fhd" | "4k"
): Promise<VideoResult> {
  const configs = {
    hd:  { w: 1280, h: 720,  label: "HD (720p)",        crf: 20 },
    fhd: { w: 1920, h: 1080, label: "Full HD (1080p)",  crf: 18 },
    "4k":  { w: 3840, h: 2160, label: "4K (2160p)",     crf: 20 },
  };
  const { w, h, label, crf } = configs[preset];

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_qual_${Date.now()}.mp4`);

  try {
    const dur = await getDuration(inputPath);
    const filter = [
      `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      "unsharp=5:5:1.0",
      "eq=contrast=1.05:saturation=1.1",
    ].join(",");

    await runFF([
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
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

// ─── Video Subtitle Overlay (bakar teks ke video) ────────────────────────────

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
  const posLabel: Record<string, string> = {
    top: "atas", middle: "tengah", bottom: "bawah",
  };

  const inputPath  = await bufferToTempFile(await fetchBuffer(videoUrl), "mp4");
  const outputPath = path.join(os.tmpdir(), `editai_sub_${Date.now()}.mp4`);

  try {
    const dur      = await getDuration(inputPath);
    const safeText = text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/:/g, "\\:")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");

    const filter = `drawtext=text='${safeText}':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=${yPos[position]}:box=1:boxcolor=black@0.55:boxborderw=8:shadowcolor=black@0.5:shadowx=2:shadowy=2`;

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
    return { success: true, outputUrl: base64, mimeType: "video/mp4", isVideo: true, message: `Subtitle di-${posLabel[position]} berhasil ditambahkan (${dur.toFixed(0)}s)!` };
  } catch (err: any) {
    return { success: false, error: `Subtitle gagal: ${err.message?.slice(0, 80)}` };
  } finally {
    await cleanup(inputPath, outputPath);
  }
}

// ─── Video Effects ────────────────────────────────────────────────────────────

const VIDEO_EFFECT_FILTERS: Record<string, { filter: string; label: string }> = {
  cinematic: {
    filter: "curves=r='0/0 128/100 255/220':g='0/0 128/110 255/210':b='0/20 128/115 255/200',eq=saturation=0.85:contrast=1.1:brightness=-0.02,vignette=PI/4",
    label: "Sinematik",
  },
  bw: {
    filter: "hue=s=0,eq=contrast=1.15:brightness=0.02",
    label: "Hitam & Putih",
  },
  vintage: {
    filter: "curves=r='0/30 128/140 255/225':g='0/20 128/130 255/215':b='0/10 128/120 255/200',hue=s=0.65,vignette=PI/3,noise=alls=8:allf=t",
    label: "Vintage/Retro",
  },
  drama: {
    filter: "eq=contrast=1.45:saturation=1.25:brightness=-0.05,unsharp=5:5:1.2,vignette=PI/5",
    label: "Drama",
  },
  vivid: {
    filter: "eq=saturation=1.85:contrast=1.1:brightness=0.02,unsharp=3:3:0.5",
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
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
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

// ─── Video Ratio (Aspect Ratio) ───────────────────────────────────────────────

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
      "-y", "-i", `"${inputPath}"`,
      "-t", String(dur),
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
