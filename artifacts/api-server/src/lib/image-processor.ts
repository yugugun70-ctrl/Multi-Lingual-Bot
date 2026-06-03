import { logger } from "./logger";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ProcessResult {
  success: boolean;
  outputUrl?: string;
  mimeType?: string;
  error?: string;
  message?: string;
  isVideo?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function fetchBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    return Buffer.from(url.split(",")[1], "base64");
  }
  const { default: https } = await import("node:https");
  const { default: http  } = await import("node:http");
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    proto.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

export async function bufferToTempFile(buf: Buffer, ext: string): Promise<string> {
  const p = path.join(os.tmpdir(), `editai_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  await fs.writeFile(p, buf);
  return p;
}

function ffmpeg(): string { return process.env.FFMPEG_PATH ?? "ffmpeg"; }

/**
 * Jalankan FFmpeg dengan filter gambar → kembalikan buffer
 * Input bisa JPG/PNG, output selalu JPG kecuali ext=png
 */
async function applyFFmpegFilter(
  inputBuf: Buffer,
  filterStr: string,
  outExt: "jpg" | "png" = "jpg",
  quality = 92
): Promise<Buffer> {
  const inputPath  = await bufferToTempFile(inputBuf, "jpg");
  const outputPath = path.join(os.tmpdir(), `editai_fx_${Date.now()}.${outExt}`);
  try {
    const qFlag = outExt === "jpg" ? `-q:v ${Math.round(1 + (100 - quality) * 30 / 100)}` : "";
    const cmd = `${ffmpeg()} -y -i "${inputPath}" -vf "${filterStr}" ${qFlag} "${outputPath}"`;
    await execAsync(cmd, { timeout: 60000 });
    return await fs.readFile(outputPath);
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {}),
    ]);
  }
}

// ─── Background Removal ───────────────────────────────────────────────────────

export async function removeBackgroundLocal(imageUrl: string): Promise<ProcessResult> {
  const buf = await fetchBuffer(imageUrl);
  const sharp = (await import("sharp")).default;

  // Coba imgly dulu (kalau native bindings tersedia)
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { removeBackground } = req("@imgly/background-removal-node") as any;
    const tmpPath = await bufferToTempFile(buf, "jpg");
    try {
      const blob = await removeBackground(tmpPath);
      const out  = Buffer.from(await blob.arrayBuffer());
      return { success: true, outputUrl: `data:image/png;base64,${out.toString("base64")}`, mimeType: "image/png", message: "Background berhasil dihapus!" };
    } finally { await fs.unlink(tmpPath).catch(() => {}); }
  } catch { /* fallback */ }

  // Fallback: algoritma berbasis tepi gambar + color distance dari border
  try {
    // Resize ke ukuran kerja
    const WORK_SIZE = 640;
    const { data, info } = await sharp(buf)
      .resize(WORK_SIZE, WORK_SIZE, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width, h = info.height, ch = 4;
    const out = Buffer.from(data);

    // Kumpulkan warna dari border (5px) sebagai sampel background
    const bgSamples: number[][] = [];
    const borderPx = Math.max(3, Math.min(8, Math.floor(Math.min(w, h) * 0.03)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < borderPx || x >= w - borderPx || y < borderPx || y >= h - borderPx) {
          const i = (y * w + x) * ch;
          bgSamples.push([data[i], data[i + 1], data[i + 2]]);
        }
      }
    }

    // Hitung mean & std dev warna background
    const mean  = [0, 0, 0];
    const std   = [0, 0, 0];
    const n = bgSamples.length;
    for (const s of bgSamples) { mean[0] += s[0] / n; mean[1] += s[1] / n; mean[2] += s[2] / n; }
    for (const s of bgSamples) {
      std[0] += (s[0] - mean[0]) ** 2 / n;
      std[1] += (s[1] - mean[1]) ** 2 / n;
      std[2] += (s[2] - mean[2]) ** 2 / n;
    }
    std[0] = Math.sqrt(std[0]); std[1] = Math.sqrt(std[1]); std[2] = Math.sqrt(std[2]);

    // Threshold adaptif berdasarkan variasi warna background
    const avgStd = (std[0] + std[1] + std[2]) / 3;
    const threshold = Math.max(35, Math.min(80, 40 + avgStd * 1.5));

    // Buat mask: hapus piksel yang mirip background
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * ch;
        const dr = Math.abs(out[i]     - mean[0]);
        const dg = Math.abs(out[i + 1] - mean[1]);
        const db = Math.abs(out[i + 2] - mean[2]);
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        mask[y * w + x] = dist < threshold ? 0 : 255; // 0=bg, 255=fg
      }
    }

    // Erosi ringan untuk membersihkan tepi
    const eroded = new Uint8Array(w * h);
    const r = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let minVal = 255;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = Math.max(0, Math.min(w - 1, x + dx));
            const ny = Math.max(0, Math.min(h - 1, y + dy));
            minVal = Math.min(minVal, mask[ny * w + nx]);
          }
        }
        eroded[y * w + x] = minVal;
      }
    }

    // Terapkan mask ke gambar
    for (let i = 0; i < w * h; i++) {
      out[i * ch + 3] = eroded[i];
    }

    // Render ke PNG + scale ke ukuran asli
    const meta = await sharp(buf).metadata();
    const result = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
      .resize(meta.width, meta.height, { fit: "inside", kernel: "lanczos3" })
      .png()
      .toBuffer();

    return {
      success: true,
      outputUrl: `data:image/png;base64,${result.toString("base64")}`,
      mimeType: "image/png",
      message: "Background dihapus! (Untuk hasil lebih presisi, tambahkan Remove.bg API key di setup)",
    };
  } catch (err: any) {
    logger.error({ err }, "Background removal gagal");
    return { success: false, error: "Hapus background gagal. Coba tambahkan Remove.bg API key di halaman setup untuk kualitas terbaik." };
  }
}

// ─── Upscale (Sharp) ─────────────────────────────────────────────────────────

export async function upscalePhotoSharp(imageUrl: string, scale = 3): Promise<ProcessResult> {
  try {
    const sharp = (await import("sharp")).default;
    const buf   = await fetchBuffer(imageUrl);
    const meta  = await sharp(buf).metadata();
    const newW  = Math.min((meta.width  ?? 800) * scale, 4096);
    const newH  = Math.min((meta.height ?? 800) * scale, 4096);

    const out = await sharp(buf)
      .resize(newW, newH, { kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.5 })
      .jpeg({ quality: 92 })
      .toBuffer();

    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: `Foto diperbesar ${scale}x dengan teknologi Lanczos!` };
  } catch (err: any) {
    return { success: false, error: `Upscale gagal: ${err.message}` };
  }
}

// ─── Enhance (Sharp) ─────────────────────────────────────────────────────────

export async function enhancePhotoSharp(imageUrl: string): Promise<ProcessResult> {
  try {
    const sharp = (await import("sharp")).default;
    const buf   = await fetchBuffer(imageUrl);
    const out   = await sharp(buf)
      .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.5 })
      .modulate({ brightness: 1.05, saturation: 1.15 })
      .gamma(1.05)
      .jpeg({ quality: 92 })
      .toBuffer();

    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Kualitas foto ditingkatkan!" };
  } catch (err: any) {
    return { success: false, error: `Enhance gagal: ${err.message}` };
  }
}

// ─── Color Correction (Sharp) ────────────────────────────────────────────────

export async function colorCorrectionSharp(imageUrl: string): Promise<ProcessResult> {
  try {
    const sharp = (await import("sharp")).default;
    const buf   = await fetchBuffer(imageUrl);
    const out   = await sharp(buf)
      .modulate({ brightness: 1.05, saturation: 1.25 })
      .normalise()
      .sharpen({ sigma: 0.8 })
      .jpeg({ quality: 92 })
      .toBuffer();

    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Warna foto dikoreksi dan dioptimalkan!" };
  } catch (err: any) {
    return { success: false, error: `Color correction gagal: ${err.message}` };
  }
}

// ─── Portrait Enhance (Sharp) ────────────────────────────────────────────────

export async function portraitEnhanceSharp(imageUrl: string): Promise<ProcessResult> {
  try {
    const sharp = (await import("sharp")).default;
    const buf   = await fetchBuffer(imageUrl);
    const out   = await sharp(buf)
      .sharpen({ sigma: 1.2 })
      .modulate({ brightness: 1.08, saturation: 1.12 })
      .gamma(0.95)
      .jpeg({ quality: 92 })
      .toBuffer();

    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Foto portrait diperhalus dan dipercerah!" };
  } catch (err: any) {
    return { success: false, error: `Portrait enhance gagal: ${err.message}` };
  }
}

// ─── Anime Effect (FFmpeg) ────────────────────────────────────────────────────
// Bilateral smooth + saturasi tinggi + edge enhancement → look animasi Jepang

export async function animeEffectHF(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    // bilateral: blur tanpa blur tepi → efek skin smooth anime
    // unsharp: perkuat garis/outline
    // eq: warna cerah vivid khas anime
    const filter = [
      "bilateral=sigmaS=20:sigmaR=0.08",
      "unsharp=5:5:2.5:5:5:0.0",
      "eq=saturation=2.0:contrast=1.15:brightness=0.03",
      "hue=s=1.5",
    ].join(",");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 92);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Anime berhasil! (Gaya Jepang vivid)" };
  } catch (err: any) {
    logger.error({ err }, "Anime effect gagal");
    return { success: false, error: `Anime effect gagal: ${err.message}` };
  }
}

// ─── Cartoon Effect (FFmpeg) ──────────────────────────────────────────────────
// Posterize warna + garis tebal → tampilan kartun/cel-shading

export async function cartoonEffectSharp(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    // hqdn3d: smooth permukaan
    // unsharp kuat: garis tebal
    // eq: saturasi tinggi, kontras
    // TODO: posterize perlu libavfilter lengkap, gunakan palettegen trick
    const filter = [
      "hqdn3d=6:4:8:5",
      "unsharp=7:7:3.5:7:7:0.0",
      "eq=saturation=2.8:contrast=1.3:brightness=0.05",
    ].join(",");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 90);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Kartun berhasil! (Cel-shading style)" };
  } catch (err: any) {
    logger.error({ err }, "Cartoon effect gagal");
    return { success: false, error: `Cartoon effect gagal: ${err.message}` };
  }
}

// ─── HDR Effect (FFmpeg) ──────────────────────────────────────────────────────
// Trending: dramatis, detail shadow/highlight

export async function hdrEffect(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    const filter = [
      "unsharp=5:5:1.5:3:3:0.5",
      "eq=contrast=1.35:saturation=1.45:brightness=-0.03:gamma=0.9",
      "hqdn3d=1.5:1:2:1.5",
    ].join(",");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 93);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek HDR berhasil! (Dramatis, detail maksimal)" };
  } catch (err: any) {
    return { success: false, error: `HDR effect gagal: ${err.message}` };
  }
}

// ─── Glow / Bloom Effect (FFmpeg) ─────────────────────────────────────────────
// Trending: efek cahaya memancar, aesthetic/dreamy

export async function glowEffect(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    // Glow: softlight blend dengan versi blur
    // Buat glow dengan overlay: original + blurred bright areas
    const filter = [
      "split[base][bloom]",
      "[bloom]gblur=sigma=12,eq=brightness=0.15:saturation=1.3[b]",
      "[base][b]blend=all_mode=screen:all_opacity=0.5",
      "eq=saturation=1.2:brightness=0.05",
    ].join(";");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 92);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Glow/Bloom berhasil! (Dreamy aesthetic)" };
  } catch (err: any) {
    logger.warn({ err }, "Glow complex filter gagal, coba simplified");
    // Fallback simplified
    try {
      const buf2  = await fetchBuffer(imageUrl);
      const simpleFilter = "gblur=sigma=2,eq=brightness=0.08:saturation=1.35,unsharp=3:3:1.0";
      const out2 = await applyFFmpegFilter(buf2, simpleFilter, "jpg", 92);
      return { success: true, outputUrl: `data:image/jpeg;base64,${out2.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Glow berhasil! (Soft dreamy look)" };
    } catch (err2: any) {
      return { success: false, error: `Glow effect gagal: ${err2.message}` };
    }
  }
}

// ─── Pencil Sketch Effect (FFmpeg) ────────────────────────────────────────────
// Trending: lukisan pensil hitam putih

export async function sketchEffect(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    // Grayscale + edge detection + invert = efek sketsa pensil
    const filter = [
      "format=gray",
      "split[edge][base]",
      "[edge]edgedetect=low=0.08:high=0.2[e]",
      "[base][e]blend=all_mode=multiply:all_opacity=0.9",
      "eq=contrast=1.4:brightness=0.15",
      "unsharp=3:3:1.5",
    ].join(";");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 92);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Sketsa Pensil berhasil!" };
  } catch {
    // Fallback simpler
    try {
      const buf2 = await fetchBuffer(imageUrl);
      const f2   = "format=gray,edgedetect=low=0.1:high=0.3,negate";
      const out2 = await applyFFmpegFilter(buf2, f2, "jpg", 92);
      return { success: true, outputUrl: `data:image/jpeg;base64,${out2.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Sketsa Pensil berhasil!" };
    } catch (err2: any) {
      return { success: false, error: `Sketch effect gagal: ${err2.message}` };
    }
  }
}

// ─── Neon / Cyberpunk Effect (FFmpeg) ─────────────────────────────────────────
// Trending: cyberpunk glow, warna neon vivid

export async function neonEffect(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    const filter = [
      "eq=saturation=3.0:contrast=1.2:brightness=-0.1",
      "gblur=sigma=1",
      "unsharp=5:5:2.0:5:5:0.5",
      "hue=s=3.0",
    ].join(",");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 91);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Neon/Cyberpunk berhasil!" };
  } catch (err: any) {
    return { success: false, error: `Neon effect gagal: ${err.message}` };
  }
}

// ─── Oil Paint Effect (FFmpeg) ───────────────────────────────────────────────
// Efek lukis minyak artistik

export async function oilPaintEffect(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    const filter = [
      "bilateral=sigmaS=30:sigmaR=0.15",
      "bilateral=sigmaS=20:sigmaR=0.1",
      "eq=saturation=1.7:contrast=1.2",
      "unsharp=5:5:1.0",
    ].join(",");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 93);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Lukis Minyak berhasil! (Oil painting style)" };
  } catch (err: any) {
    return { success: false, error: `Oil paint effect gagal: ${err.message}` };
  }
}

// ─── Vintage / Film Effect (FFmpeg) ──────────────────────────────────────────
// Efek foto jadul/film grain retro

export async function vintageEffect(imageUrl: string): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(imageUrl);
    const filter = [
      "eq=saturation=0.65:contrast=1.1:brightness=-0.05:gamma=1.2",
      "hue=h=10:s=0.7",
      "curves=r='0/0 0.25/0.22 0.75/0.78 1/0.95':g='0/0 0.25/0.23 0.75/0.76 1/0.93':b='0/0.05 0.25/0.25 0.75/0.72 1/0.88'",
      "noise=alls=12:allf=t+u",
    ].join(",");

    const out = await applyFFmpegFilter(buf, filter, "jpg", 90);
    return { success: true, outputUrl: `data:image/jpeg;base64,${out.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Vintage/Film berhasil! (Retro analog look)" };
  } catch (err: any) {
    logger.warn({ err }, "Vintage complex gagal, simplified");
    try {
      const buf2 = await fetchBuffer(imageUrl);
      const f2   = "eq=saturation=0.6:contrast=1.1:gamma=1.15,hue=h=8:s=0.6";
      const out2 = await applyFFmpegFilter(buf2, f2, "jpg", 90);
      return { success: true, outputUrl: `data:image/jpeg;base64,${out2.toString("base64")}`, mimeType: "image/jpeg", message: "Efek Vintage berhasil!" };
    } catch (err2: any) {
      return { success: false, error: `Vintage effect gagal: ${err2.message}` };
    }
  }
}

// ─── Style Transfer (simple) ─────────────────────────────────────────────────

export async function styleTransferHF(imageUrl: string, style: string): Promise<ProcessResult> {
  const s = style.toLowerCase();
  if (s.includes("anime")) return animeEffectHF(imageUrl);
  if (s.includes("cartoon")) return cartoonEffectSharp(imageUrl);
  if (s.includes("oil") || s.includes("painting")) return oilPaintEffect(imageUrl);
  if (s.includes("sketch") || s.includes("pencil")) return sketchEffect(imageUrl);
  if (s.includes("vintage") || s.includes("retro") || s.includes("film")) return vintageEffect(imageUrl);
  if (s.includes("neon") || s.includes("cyber")) return neonEffect(imageUrl);
  if (s.includes("hdr")) return hdrEffect(imageUrl);
  if (s.includes("glow") || s.includes("bloom") || s.includes("dreamy")) return glowEffect(imageUrl);
  return oilPaintEffect(imageUrl); // default
}

// ─── Subtitle template (FFmpeg probe) ────────────────────────────────────────

export async function generateSubtitleNvidia(videoUrl: string, language = "id"): Promise<ProcessResult> {
  try {
    const buf = await fetchBuffer(videoUrl);
    const inputPath = await bufferToTempFile(buf, "mp4");
    let duration = 60;
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
      );
      duration = parseFloat(stdout.trim()) || 60;
    } catch {}
    await fs.unlink(inputPath).catch(() => {});

    const chunkSec = 5;
    const chunks   = Math.ceil(duration / chunkSec);
    let srt = "";
    for (let i = 0; i < chunks; i++) {
      const s = i * chunkSec;
      const e = Math.min((i + 1) * chunkSec, duration);
      srt += `${i + 1}\n${toSrtTime(s)} --> ${toSrtTime(e)}\n[Subtitle ${i + 1}]\n\n`;
    }

    return {
      success: true,
      outputUrl: `data:text/plain;base64,${Buffer.from(srt).toString("base64")}`,
      mimeType: "text/srt",
      message: `Template subtitle (${chunks} bagian, ${Math.round(duration)}s) berhasil dibuat!`,
    };
  } catch (err: any) {
    return { success: false, error: `Subtitle gagal: ${err.message}` };
  }
}

export async function generateSubtitleHF(audioUrl: string, language = "id"): Promise<ProcessResult> {
  return generateSubtitleNvidia(audioUrl, language);
}

function toSrtTime(seconds: number): string {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}
